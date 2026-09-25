"""Wrap the Bun-compiled `inwards` binaries in platform wheels, like Ruff and ty.

Each wheel holds one binary as a script, so `uv add --dev inwards`,
`uvx inwards` and `pipx install inwards` put `inwards` on PATH with no Python
code involved. The platform tag comes from the binary itself: the newest
glibc symbol it needs (manylinux), or the minimum macOS version in its
LC_BUILD_VERSION load command, so a wheel never claims more than it runs on.

    python3 scripts/build-wheels.py dist 0.1.0-rc.1   # writes dist/wheels/*.whl

The version may be a git tag (`v0.1.0-rc.1`); it is turned into PEP 440 (`0.1.0rc1`).

No musllinux wheel: the musl binary needs libstdc++, which the musllinux
policy doesn't allow a wheel to assume. Alpine users take the raw binary.
"""

import base64
import hashlib
import re
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUMMARY = "Architecture linter for Python that keeps AI coding agents inside your layers."
DOCS = "https://sircypkowskyy.github.io/inwards"

# binary name -> (platform tag template, script name inside the wheel)
BINARIES = {
    "inwards-linux-x64": ("manylinux_{glibc}_x86_64", "inwards"),
    "inwards-linux-arm64": ("manylinux_{glibc}_aarch64", "inwards"),
    "inwards-darwin-x64": ("macosx_{macos}_x86_64", "inwards"),
    "inwards-darwin-arm64": ("macosx_{macos}_arm64", "inwards"),
    "inwards-windows-x64.exe": ("win_amd64", "inwards.exe"),
}
# NUL-terminated, as in the dynamic string table (which shares string tails, so
# no leading NUL), so a version inside a JS string in the bundle doesn't count.
GLIBC = re.compile(rb"GLIBC_2\.(\d+)\x00")
PRE = re.compile(r"^(\d+\.\d+\.\d+)(?:-(a|alpha|b|beta|rc)\.?(\d+))?$")
PEP440_PRE = {"a": "a", "alpha": "a", "b": "b", "beta": "b", "rc": "rc"}
LC_BUILD_VERSION = 0x32
MACHO_64 = 0xFEEDFACF


def pep440(version: str) -> str:
    """Turn `v0.1.0-rc.1` or `0.1.0` into a PEP 440 version (`0.1.0rc1`)."""
    match = PRE.match(version.removeprefix("v"))
    if not match:
        sys.exit(f"build-wheels: can't turn {version!r} into a PEP 440 version")
    base, kind, number = match.groups()
    return base if kind is None else f"{base}{PEP440_PRE[kind]}{number}"


def glibc_tag(data: bytes) -> str:
    """The manylinux glibc part (`2_17`) for the newest GLIBC_2.x symbol the binary needs."""
    minors = [int(m) for m in GLIBC.findall(data)]
    if not minors:
        sys.exit("build-wheels: no GLIBC symbol versions found in a glibc binary")
    return f"2_{max(minors)}"


def macos_tag(data: bytes) -> str:
    """The macosx version part (`13_0`) from the binary's LC_BUILD_VERSION `minos`."""
    magic, _, _, _, ncmds, _, _, _ = struct.unpack_from("<IiiIIIII", data, 0)
    if magic != MACHO_64:
        sys.exit("build-wheels: not a 64-bit little-endian Mach-O binary")
    offset = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", data, offset)
        if cmd == LC_BUILD_VERSION:
            (minos,) = struct.unpack_from("<I", data, offset + 12)
            return f"{minos >> 16}_{(minos >> 8) & 0xFF}"
        offset += size
    sys.exit("build-wheels: no LC_BUILD_VERSION in a macOS binary")


def platform_tag(template: str, data: bytes) -> str:
    """Fill in the glibc or macOS part a platform tag template needs."""
    if "{glibc}" in template:
        return template.format(glibc=glibc_tag(data))
    if "{macos}" in template:
        return template.format(macos=macos_tag(data))
    return template


def record_line(name: str, content: bytes) -> str:
    """One RECORD row: path, urlsafe-base64 SHA-256 without padding, size."""
    digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=")
    return f"{name},sha256={digest.decode()},{len(content)}"


def metadata(version: str) -> bytes:
    """The wheel's METADATA, with the PyPI README as its long description."""
    readme = (ROOT / "packaging" / "pypi" / "README.md").read_text(encoding="utf-8")
    head = "\n".join(
        [
            "Metadata-Version: 2.1",
            "Name: inwards",
            f"Version: {version}",
            f"Summary: {SUMMARY}",
            f"Home-page: {DOCS}",
            f"Project-URL: Documentation, {DOCS}",
            "License: MIT",
            "Requires-Python: >=3.8",
            "Classifier: Development Status :: 2 - Pre-Alpha",
            "Classifier: Environment :: Console",
            "Classifier: Intended Audience :: Developers",
            "Classifier: License :: OSI Approved :: MIT License",
            "Classifier: Topic :: Software Development :: Quality Assurance",
            "Description-Content-Type: text/markdown",
        ]
    )
    return f"{head}\n\n{readme}".encode()


def build(binary: Path, version: str, out: Path) -> Path:
    """Write one wheel holding `binary` as the `inwards` script."""
    template, script = BINARIES[binary.name]
    data = binary.read_bytes()
    tag = f"py3-none-{platform_tag(template, data)}"
    dist_info = f"inwards-{version}.dist-info"
    files = {
        f"inwards-{version}.data/scripts/{script}": data,
        f"{dist_info}/METADATA": metadata(version),
        f"{dist_info}/WHEEL": (
            f"Wheel-Version: 1.0\nGenerator: inwards build-wheels.py\nRoot-Is-Purelib: false\nTag: {tag}\n"
        ).encode(),
        f"{dist_info}/LICENSE": (ROOT / "LICENSE").read_bytes(),
    }
    record = [record_line(name, content) for name, content in files.items()]
    record.append(f"{dist_info}/RECORD,,")
    files[f"{dist_info}/RECORD"] = ("\n".join(record) + "\n").encode()
    wheel = out / f"inwards-{version}-{tag}.whl"
    with zipfile.ZipFile(wheel, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            # Scripts are executable; everything else is a plain file.
            mode = 0o755 if ".data/scripts/" in name else 0o644
            info.external_attr = (0o100000 | mode) << 16
            archive.writestr(info, content)
    return wheel


def main() -> None:
    """Build a wheel for every known binary found in the given directory."""
    if len(sys.argv) != 3:
        sys.exit("usage: build-wheels.py <dist-dir> <version>")
    dist, version = Path(sys.argv[1]), pep440(sys.argv[2])
    out = dist / "wheels"
    out.mkdir(parents=True, exist_ok=True)
    built = [build(dist / name, version, out) for name in BINARIES if (dist / name).exists()]
    if not built:
        sys.exit(f"build-wheels: no binaries in {dist}")
    for wheel in built:
        print(f"{wheel.name}  {wheel.stat().st_size / 1_048_576:.1f} MiB")


if __name__ == "__main__":
    main()
