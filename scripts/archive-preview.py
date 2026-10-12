import ctypes
import ctypes.util
import json
import os
import stat
import sys
import unicodedata


def inspect(file_path, original_name):
    library = os.environ.get('DDATO_DRIVE_LIBARCHIVE') or next((candidate for candidate in [
        '/opt/homebrew/opt/libarchive/lib/libarchive.dylib',
        '/usr/local/opt/libarchive/lib/libarchive.dylib'
    ] if os.path.isfile(candidate)), None) or ctypes.util.find_library('archive')
    if not library:
        raise RuntimeError('libarchive is unavailable')
    lib = ctypes.CDLL(library)

    def bind(name, result, arguments):
        function = getattr(lib, name)
        function.restype = result
        function.argtypes = arguments
        return function

    pointer = ctypes.c_void_p
    new = bind('archive_read_new', pointer, [])
    free = bind('archive_read_free', ctypes.c_int, [pointer])
    open_file = bind('archive_read_open_filename', ctypes.c_int, [pointer, ctypes.c_char_p, ctypes.c_size_t])
    next_header = bind('archive_read_next_header', ctypes.c_int, [pointer, ctypes.POINTER(pointer)])
    pathname = bind('archive_entry_pathname_utf8', ctypes.c_char_p, [pointer])
    fallback_path = bind('archive_entry_pathname', ctypes.c_char_p, [pointer])
    size = bind('archive_entry_size', ctypes.c_int64, [pointer])
    size_set = bind('archive_entry_size_is_set', ctypes.c_int, [pointer])
    filetype = bind('archive_entry_filetype', ctypes.c_uint, [pointer])
    encrypted = bind('archive_entry_is_encrypted', ctypes.c_int, [pointer])
    format_name = bind('archive_format_name', ctypes.c_char_p, [pointer])
    reader = new()
    try:
        for filter_name in ['none', 'gzip', 'bzip2', 'xz', 'lzma', 'zstd', 'lz4', 'lzip', 'compress']:
            method = 'archive_read_support_filter_' + filter_name
            if hasattr(lib, method):
                bind(method, ctypes.c_int, [pointer])(reader)
        for kind in ['tar', 'zip', 'cpio', 'ar', '7zip', 'rar', 'rar5', 'cab', 'iso9660', 'empty']:
            method = 'archive_read_support_format_' + kind
            if hasattr(lib, method):
                bind(method, ctypes.c_int, [pointer])(reader)
        raw = original_name.lower().endswith(('.gz', '.bz2', '.xz', '.zst', '.lz4', '.lz', '.lzma')) and not original_name.lower().endswith(('.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst', '.tar.lz4', '.tar.lz', '.tar.lzma'))
        if raw:
            bind('archive_read_support_format_raw', ctypes.c_int, [pointer])(reader)
        if open_file(reader, os.fsencode(file_path), 65536) < -20:
            raise ValueError('Archive could not be opened')
        entries = []
        entry = pointer()
        truncated = False
        while True:
            status = next_header(reader, ctypes.byref(entry))
            if status == 1:
                break
            if status < -20:
                raise ValueError('Invalid or encrypted archive directory')
            if len(entries) >= 10000:
                truncated = True
                break
            value = (pathname(entry) or fallback_path(entry) or b'').decode('utf-8', errors='replace')
            value = unicodedata.normalize('NFC', value.replace('\\', '/'))
            while value.startswith('./'):
                value = value[2:]
            if value in ['', '.']:
                continue
            if len(value) > 4096 or value.startswith('/') or '..' in value.split('/') or (len(value) > 1 and value[1] == ':'):
                raise ValueError('Unsafe archive path')
            directory = filetype(entry) == stat.S_IFDIR
            if directory and not value.endswith('/'):
                value += '/'
            if raw and value == 'data' and (format_name(reader) or b'').lower().startswith(b'raw'):
                value = original_name.rsplit('.', 1)[0]
            entry_size = size(entry) if size_set(entry) else None
            if entry_size is not None and (entry_size < 0 or entry_size > 9007199254740991):
                raise ValueError('Invalid archive size')
            entries.append({'path': value, 'directory': directory, 'sizeBytes': entry_size,
                            'compressedBytes': None, 'encrypted': bool(encrypted(entry)),
                            'link': filetype(entry) == stat.S_IFLNK})
        description = (format_name(reader) or b'archive').decode('utf-8', errors='replace')
        return {'kind': 'archive', 'format': description, 'totalEntries': len(entries),
                'truncated': truncated, 'countIsPartial': truncated, 'entries': entries}
    finally:
        free(reader)


if __name__ == '__main__':
    try:
        print(json.dumps(inspect(sys.argv[1], sys.argv[2]), ensure_ascii=True))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
