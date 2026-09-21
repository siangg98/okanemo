# One shared business dataset per installation

An Okanemo installation will serve one shared business dataset to browsers on the same computer. Existing browser records will move through an explicit JSON import, and a separate backup will be kept outside the working Docker volume. We chose this scope to support the current single-business workflow without introducing per-person accounts or data partitioning.
