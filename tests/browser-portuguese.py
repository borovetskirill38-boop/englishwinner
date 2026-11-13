"""Complete Brazilian Portuguese topic and mode browser scenarios."""
import os
from pathlib import Path
import runpy
os.environ["QUIZ_LANGUAGE"] = "pt-BR"
runpy.run_path(str(Path(__file__).with_name("browser-language.py")), run_name="__main__")
