#!/usr/bin/env python3
"""
Put update information into a built AppImage, so AppImageUpdate can update it.

Every AppImage carries an ELF section called `.upd_info` that update tools read
to learn where newer builds live. electron-builder 26 builds its AppImages with
mksquashfs and a runtime rather than with appimagetool, and has no zsync support
at all, so that section ships as 1 KB of zeros and AppImageUpdate has nothing to
work with. This writes the string in, exactly as `appimagetool -u` would.

The string used is the GitHub transport:

    gh-releases-zsync|SAADAT-Abu|Morphly|latest|Morphly-*.AppImage.zsync

which asks GitHub for the latest release and takes whichever zsync file matches
the glob, so no version is baked into the build and every release keeps working
without reissuing the one before it.

Writing happens in place and changes no byte count, but it does change the
file's checksum, so run it BEFORE making the zsync file, publishing checksums
or uploading anywhere.

    python tools/appimage_update_info.py app/release/Morphly-0.6.0.AppImage
    python tools/appimage_update_info.py --show app/release/Morphly-0.6.0.AppImage
"""

import argparse
import struct
import sys
from pathlib import Path

DEFAULT_INFO = "gh-releases-zsync|SAADAT-Abu|Morphly|latest|Morphly-*.AppImage.zsync"
SECTION = ".upd_info"


def section_span(data: bytes, name: str) -> tuple[int, int]:
    """Byte offset and size of one ELF section, by name."""
    if data[:4] != b"\x7fELF":
        raise SystemExit("Not an ELF file, so not an AppImage")
    if data[4] != 2:
        raise SystemExit("Only 64 bit AppImages are handled")

    shoff, = struct.unpack_from("<Q", data, 0x28)
    shentsize, shnum, shstrndx = struct.unpack_from("<HHH", data, 0x3A)

    def entry(index: int) -> tuple[int, int, int]:
        base = shoff + index * shentsize
        name_off, = struct.unpack_from("<I", data, base)
        offset, = struct.unpack_from("<Q", data, base + 0x18)
        size, = struct.unpack_from("<Q", data, base + 0x20)
        return name_off, offset, size

    _, strtab_off, _ = entry(shstrndx)
    for index in range(shnum):
        name_off, offset, size = entry(index)
        end = data.index(b"\0", strtab_off + name_off)
        if data[strtab_off + name_off:end].decode() == name:
            return offset, size
    raise SystemExit(f"No {name} section: this does not look like an AppImage runtime")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("appimage", type=Path)
    parser.add_argument("--info", default=DEFAULT_INFO, help="update information string")
    parser.add_argument("--show", action="store_true", help="print what is there and stop")
    args = parser.parse_args()

    data = bytearray(args.appimage.read_bytes())
    offset, size = section_span(bytes(data), SECTION)

    if args.show:
        current = bytes(data[offset:offset + size]).split(b"\0", 1)[0]
        print(current.decode() if current else "(empty: no update information)")
        return 0

    payload = args.info.encode()
    if len(payload) >= size:
        raise SystemExit(f"Update information is {len(payload)} bytes; the section holds {size - 1}")

    data[offset:offset + size] = payload + b"\0" * (size - len(payload))
    args.appimage.write_bytes(bytes(data))
    print(f"{args.appimage.name}: wrote {len(payload)} bytes into {SECTION}")
    print(f"  {args.info}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
