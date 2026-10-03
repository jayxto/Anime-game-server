from pathlib import Path
import subprocess

# Share the server's actual JavaScript resolver instead of approximating it with regexes.
subprocess.run(['node', str(Path(__file__).with_name('audit-transform.cjs'))], check=True)
