/**
 * @file The top-level module names of the Python standard library, which INW005
 * needs to tell a stdlib import from a third-party one. The list is data kept
 * by hand; `STDLIB` says how to regenerate it.
 */
/**
 * Top-level modules of the Python standard library: the union of
 * `sys.stdlib_module_names` on CPython 3.11 to 3.14, plus the modules 3.10 and
 * older still had (`binhex`, `formatter`, `parser`, `symbol`, ...), so a
 * project on any supported Python sorts its imports the same way (INW005).
 * `__main__`, the running script, is added by hand: it is never a library.
 * Regenerate by printing that set on each new CPython and taking the union.
 */
export const STDLIB: ReadonlySet<string> = new Set(
  `
__main__ _abc abc aifc _aix_support _android_support annotationlib antigravity _apple_support argparse
array _ast ast _ast_unparse asynchat _asyncio asyncio asyncore atexit audioop base64 bdb
binascii binhex _bisect bisect _blake2 _bootsubprocess builtins _bz2 bz2 calendar cgi cgitb
chunk cmath cmd code _codecs codecs _codecs_cn _codecs_hk _codecs_iso2022 _codecs_jp _codecs_kr
_codecs_tw codeop _collections collections _collections_abc _colorize colorsys _compat_pickle
compileall _compression compression concurrent configparser contextlib _contextvars contextvars
copy copyreg cProfile _crypt crypt _csv csv _ctypes ctypes _curses curses _curses_panel
dataclasses _datetime datetime _dbm dbm _decimal decimal difflib dis distutils doctest
_dummy_thread dummy_threading _elementtree email encodings ensurepip enum errno faulthandler
fcntl filecmp fileinput fnmatch formatter fractions _frozen_importlib _frozen_importlib_external
ftplib _functools functools __future__ gc _gdbm genericpath getopt getpass gettext glob graphlib
grp gzip _hashlib hashlib _heapq heapq _hmac hmac html http idlelib imaplib imghdr _imp imp
importlib inspect _interpchannels _interpqueues _interpreters _io io _ios_support ipaddress
itertools _json json keyword lib2to3 linecache _locale locale logging _lsprof _lzma lzma macpath
mailbox mailcap _markupbase marshal math _md5 mimetypes mmap modulefinder _msi msilib msvcrt
_multibytecodec _multiprocessing multiprocessing netrc nis nntplib nt ntpath nturl2path numbers
_opcode opcode _opcode_metadata _operator operator optparse os ossaudiodev _osx_support
_overlapped parser pathlib pdb _pickle pickle pickletools pipes pkgutil platform plistlib poplib
posix posixpath _posixshmem _posixsubprocess pprint profile pstats pty pwd _py_abc pyclbr
py_compile _pydatetime _pydecimal pydoc pydoc_data pyexpat _pyio _pylong _pyrepl _py_warnings
_queue queue quopri _random random re readline _remote_debugging reprlib resource rlcompleter
runpy sched _scproxy secrets select selectors _sha1 _sha2 _sha256 _sha3 _sha512 shelve shlex
shutil _signal signal site _sitebuiltins smtpd smtplib sndhdr _socket socket socketserver spwd
_sqlite3 sqlite3 _sre sre_compile sre_constants sre_parse _ssl ssl _stat stat _statistics
statistics _string string stringprep _strptime _struct struct subprocess _suggestions sunau
symbol _symtable symtable sys _sysconfig sysconfig syslog tabnanny tarfile telnetlib tempfile
termios textwrap this _thread threading _threading_local time timeit _tkinter tkinter token
_tokenize tokenize tomllib trace traceback _tracemalloc tracemalloc tty turtle turtledemo _types
types _typing typing unicodedata unittest urllib uu _uuid uuid venv _warnings warnings wave
_weakref weakref _weakrefset webbrowser _winapi winreg winsound _wmi wsgiref xdrlib xml xmlrpc
zipapp zipfile zipimport zlib _zoneinfo zoneinfo _zstd
`
    .trim()
    .split(/\s+/u),
);
