"""Maakt `python -m notulen gesprek.mp3` mogelijk."""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
