# Keep dated backups outside the working volume

The app will write dated backups to a host folder, keep 30 daily copies, and make an extra copy before a restore or Clear All Data. Restore and clear require strong confirmation. This gives a recovery path if the working Docker volume is removed or damaged. The operator will copy the host folder off-device; copies on the same computer alone do not cover computer or disk failure.
