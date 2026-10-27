// Gemeinsamer Live-Kanal (Server-Sent Events) für Datei-Drop und Watch-Party.
//
// EventSource kann keinen Authorization-Header mitschicken. Damit das JWT nicht
// in der URL (und damit im Log) landet, holt sich der Browser vorher per
// normalem API-Aufruf ein kurzlebiges Einmal-Ticket und hängt nur das an.
const crypto = require('crypto');

const tickets = new Map(); // ticket -> { user, scope, expires }
const TICKET_TTL = 60 * 1000;

function issueTicket(user, scope) {
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticket, { user: { id: user.id, username: user.username }, scope, expires: Date.now() + TICKET_TTL });
  return ticket;
}

// Löst ein Ticket genau einmal ein. Gibt den User zurück oder null.
function redeemTicket(ticket, scope) {
  const t = tickets.get(ticket);
  if (!t) return null;
  tickets.delete(ticket);
  if (t.scope !== scope || Date.now() > t.expires) return null;
  return t.user;
}

// Öffnet einen SSE-Stream auf res. Gibt ein Objekt mit send() zurück.
function openStream(req, res, onClose) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx soll nicht puffern
  });
  res.write('retry: 3000\n\n');

  // Kommentarzeile alle 25 s hält Proxys und Mobilfunk-NAT wach
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  let closed = false;
  req.on('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    onClose();
  });

  return {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of tickets) if (now > t.expires) tickets.delete(k);
}, 60 * 1000).unref();

module.exports = { issueTicket, redeemTicket, openStream };
