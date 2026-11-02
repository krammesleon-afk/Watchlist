package de.sathonet.watchlist;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Holt im Hintergrund neue Benachrichtigungen ab (siehe Notifier). */
public class NotificationJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            Notifier.poll(getApplicationContext());
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
