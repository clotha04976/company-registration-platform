"""Run a uvicorn app that cannot outlive the Vite dev server that launched it.

Signal handlers are not enough: when the terminal window is closed or the parent
is killed outright, no handler runs and the service keeps holding its port, so
the next start fails with "error while attempting to bind". A watchdog thread
polling the parent PID survives that case because it needs no cooperation from
whatever killed the parent.

Usage: python run_service.py <app> <host> <port> <parent-pid>
"""
from __future__ import annotations

import os
import sys
import threading
import time

POLL_SECONDS = 2.0


def _parent_alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes

        SYNCHRONIZE = 0x00100000
        STILL_ACTIVE = 259
        kernel32 = ctypes.windll.kernel32
        # PROCESS_QUERY_LIMITED_INFORMATION is needed to read the exit code; a
        # recycled PID would otherwise look alive forever.
        handle = kernel32.OpenProcess(SYNCHRONIZE | 0x1000, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        # Signal 0 only checks for existence; it is never delivered.
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _watch(pid: int) -> None:
    while True:
        time.sleep(POLL_SECONDS)
        if not _parent_alive(pid):
            # os._exit skips atexit and uvicorn's shutdown, which is what we want
            # here: the parent is already gone and nothing can consume the logs.
            os._exit(0)


def main() -> None:
    app, host, port, parent_pid = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    # The service package lives in the working directory, not next to this script.
    sys.path.insert(0, os.getcwd())
    threading.Thread(target=_watch, args=(parent_pid,), daemon=True).start()

    import uvicorn

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
