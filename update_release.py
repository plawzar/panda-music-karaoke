"""Offer a verified GitHub release before starting the local studio."""

from contextlib import contextmanager
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import socket
import stat
import sys
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zipfile import ZipFile

REPO = "plawzar/panda-music-karaoke"
RELEASES = f"https://api.github.com/repos/{REPO}/releases?per_page=20"
DOWNLOAD = f"https://github.com/{REPO}/releases/download/"
ARCHIVE_PREFIX = "PANDA MUSIC Karaoke Studio/"
MAC_LAUNCHER = "Launch PANDA MUSIC Karaoke - Mac.command"
WINDOWS_LAUNCHER = "Launch PANDA MUSIC Karaoke - Windows.bat"
REQUIRED = {"VERSION", "app.py", "update_release.py", "static/index.html", MAC_LAUNCHER, WINDOWS_LAUNCHER}
ROOT_FILES = {MAC_LAUNCHER, WINDOWS_LAUNCHER, "VERSION", "LICENSE", "README.md", "NOTICE.md", "START-HERE.txt",
              "USAGE-POLICY.md", ".gitignore", ".gitattributes", "install.bat", "start.bat", "setup-windows.ps1"}
ASSETS = {
    "static": {".css", ".docx", ".html", ".ico", ".jpeg", ".jpg", ".js", ".json", ".png", ".svg", ".txt", ".woff2"},
    "docs": {".json", ".md", ".png"},
    "resources": {".mp3", ".txt"},
}
MAX_ARCHIVE = 64 * 1024 * 1024
RESTART = 20
BLOCKED = 21


class GitHubRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        destination = urlsplit(newurl)
        if destination.scheme != "https" or destination.netloc not in {
            "github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com",
        }:
            raise ValueError("unexpected download redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def get_bytes(url, limit):
    request = Request(url, headers={"User-Agent": "PANDA-MUSIC-Karaoke-Studio", "Accept": "application/vnd.github+json"})
    with build_opener(GitHubRedirects).open(request, timeout=5) as response:
        payload = response.read(limit + 1)
    if len(payload) > limit:
        raise ValueError("download exceeds the size limit")
    return payload


def version_key(tag):
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?", tag or "")
    if match is None:
        return None
    major, minor, patch, beta = match.groups()
    return int(major), int(minor), int(patch), beta is None, int(beta or 0)


def find_release(current, releases):
    installed = version_key(current)
    if installed is None:
        raise ValueError("unsupported installed version")
    candidates = []
    for release in releases:
        tag = release.get("tag_name", "")
        version = version_key(tag)
        if release.get("draft") or version is None or version <= installed:
            continue
        if installed[3] and (not version[3] or release.get("prerelease")):
            continue
        filename = f"PANDA-MUSIC-Karaoke-Studio-Windows-macOS-{tag}.zip"
        expected_url = f"{DOWNLOAD}{tag}/{filename}"
        for asset in release.get("assets", []):
            digest = asset.get("digest") or ""
            size = asset.get("size") or 0
            if (asset.get("name") == filename and asset.get("state") == "uploaded"
                    and asset.get("browser_download_url") == expected_url
                    and re.fullmatch(r"sha256:[0-9a-f]{64}", digest) and 0 < size <= MAX_ARCHIVE):
                candidates.append((version, tag, expected_url, digest[7:], size))
                break
    return max(candidates, default=None)


def package_path(name):
    if not name.startswith(ARCHIVE_PREFIX):
        raise ValueError("unexpected archive root")
    parts = name[len(ARCHIVE_PREFIX):].split("/")
    for part in parts:
        if (not part or part in {".", ".."} or part.endswith((" ", "."))
                or re.search(r'[\\:<>"|?*\x00-\x1f]', part) or PureWindowsPath(part).is_reserved()):
            raise ValueError("unsafe archive path")
    path = PurePosixPath(*parts)
    if len(parts) == 1:
        allowed = path.name in ROOT_FILES or re.fullmatch(r"[a-z][a-z0-9_]*\.py|requirements[\w-]*\.txt", path.name)
    else:
        allowed = path.suffix.lower() in ASSETS.get(parts[0], set()) and not any(p.startswith(".") for p in parts)
    if not allowed:
        raise ValueError(f"unexpected package file: {path}")
    return path


def local_path(root, relative):
    path = root
    for part in relative.parts:
        path /= part
        if path.is_symlink() or path.is_junction():
            raise ValueError(f"linked installation path: {path}")
    return path


@contextmanager
def update_lock(area):
    with (area / "lock").open("a+b") as lock:
        try:
            if os.name == "nt":
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        yield True


def stage_zip(payload, tag, folder):
    paths = {}
    with ZipFile(BytesIO(payload)) as package:
        if sum(entry.file_size for entry in package.infolist()) > MAX_ARCHIVE * 2:
            raise ValueError("expanded package is too large")
        for entry in package.infolist():
            if entry.is_dir():
                continue
            path = package_path(entry.filename)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in (0, stat.S_IFREG) or str(path).casefold() in paths:
                raise ValueError("package contains a link or a duplicate file")
            paths[str(path).casefold()] = path
            output = folder / path
            output.parent.mkdir(parents=True, exist_ok=True)
            with package.open(entry) as source, output.open("wb") as destination:
                shutil.copyfileobj(source, destination)
            if path == PurePosixPath(MAC_LAUNCHER):
                output.chmod(0o755)
    if not REQUIRED.issubset(str(p) for p in paths.values()) or (folder / "VERSION").read_text().strip() != tag:
        raise ValueError("update package is incomplete or its version does not match")
    return sorted(paths.values(), key=lambda path: path.name == "VERSION")


def finish_journal(area):
    pending = area / "pending"
    completed = area / "completed"
    if completed.exists():
        shutil.rmtree(completed)
    pending.rename(completed)
    shutil.rmtree(completed, ignore_errors=True)


def rollback(root, area):
    pending = area / "pending"
    plan = json.loads((pending / "plan.json").read_text())
    for name, existed in reversed(plan):
        relative = package_path(ARCHIVE_PREFIX + name)
        destination = local_path(root, relative)
        if existed:
            restored = pending / "restore"
            shutil.copy2(pending / "backup" / relative, restored)
            destination.parent.mkdir(parents=True, exist_ok=True)
            restored.replace(destination)
        else:
            destination.unlink(missing_ok=True)
    finish_journal(area)


def install_update(root, area, payload, tag):
    with TemporaryDirectory(dir=area) as temporary:
        staging = Path(temporary)
        paths = stage_zip(payload, tag, staging / "new")
        plan = []
        for relative in paths:
            destination = local_path(root, relative)
            if destination.exists():
                if not destination.is_file():
                    raise ValueError(f"expected a file at {relative}")
                backup = staging / "backup" / relative
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(destination, backup)
            plan.append((relative.as_posix(), destination.exists()))
        (staging / "plan.json").write_text(json.dumps(plan))
        pending = staging.rename(area / "pending")
        try:
            for relative in paths:
                destination = local_path(root, relative)
                destination.parent.mkdir(parents=True, exist_ok=True)
                (pending / "new" / relative).replace(destination)
        except BaseException:
            rollback(root, area)
            raise
        finish_journal(area)


def studio_running():
    port = int(os.environ.get("PANDA_STUDIO_PORT", "8001"))
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            return True
    except OSError:
        return False


def main(root):
    if studio_running():
        return 0
    area = local_path(root, Path(".runtime/release-update"))
    area.mkdir(parents=True, exist_ok=True)
    with update_lock(area) as locked:
        if not locked:
            print("The studio update checker is already open in another launcher.", flush=True)
            return BLOCKED
        if (area / "pending").exists():
            rollback(root, area)
            print("Recovered the previous studio version after an interrupted update.", flush=True)
            return RESTART
        if not sys.stdin.isatty():
            return 0
        current = (root / "VERSION").read_text().strip()
        candidate = find_release(current, json.loads(get_bytes(RELEASES, 1024 * 1024)))
        if not candidate:
            return 0
        _, tag, url, digest, size = candidate
        if input(f"Studio {tag} is available. Install now? [y/N] ").strip().lower() not in {"y", "yes", "д", "да"}:
            return 0
        if studio_running():
            print("Close the running studio and start the launcher again to update.", flush=True)
            return 0
        print(f"Downloading studio {tag} from GitHub…", flush=True)
        payload = get_bytes(url, size)
        if len(payload) != size or sha256(payload).hexdigest() != digest:
            raise ValueError("update file does not match its GitHub checksum")
        if studio_running():
            print("Close the running studio and start the launcher again to update.", flush=True)
            return 0
        install_update(root, area, payload, tag)
        print(f"Studio {tag} installed. Restarting the launcher…", flush=True)
        return RESTART


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    try:
        sys.exit(main(root))
    except (Exception, KeyboardInterrupt) as error:
        print(f"Studio update: {error}", file=sys.stderr, flush=True)
        if (root / ".runtime/release-update/pending").exists():
            print("Run the launcher again to recover the interrupted update.", file=sys.stderr, flush=True)
            sys.exit(BLOCKED)
