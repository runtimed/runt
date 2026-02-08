"""Tests for sidecar launch functionality."""

from unittest.mock import MagicMock, patch

import pytest

from runtimed._sidecar import sidecar


def test_sidecar_with_explicit_connection_file(tmp_path):
    """Launch sidecar with an explicit connection file."""
    conn_file = tmp_path / "kernel.json"
    conn_file.write_text('{"key": "test"}')

    mock_popen = MagicMock()
    with patch("runtimed._sidecar.find_binary", return_value="/usr/bin/runt"), \
         patch("subprocess.Popen", return_value=mock_popen) as popen_call:
        result = sidecar(str(conn_file))

        assert result is mock_popen
        popen_call.assert_called_once()
        cmd = popen_call.call_args[0][0]
        assert cmd[0] == "/usr/bin/runt"
        assert cmd[1] == "sidecar"
        assert "--quiet" in cmd
        assert str(conn_file) in cmd


def test_sidecar_without_quiet(tmp_path):
    """Launch sidecar without quiet flag."""
    conn_file = tmp_path / "kernel.json"
    conn_file.write_text('{"key": "test"}')

    mock_popen = MagicMock()
    with patch("runtimed._sidecar.find_binary", return_value="/usr/bin/runt"), \
         patch("subprocess.Popen", return_value=mock_popen) as popen_call:
        sidecar(str(conn_file), quiet=False)

        cmd = popen_call.call_args[0][0]
        assert "--quiet" not in cmd


def test_sidecar_with_dump(tmp_path):
    """Launch sidecar with dump file."""
    conn_file = tmp_path / "kernel.json"
    conn_file.write_text('{"key": "test"}')
    dump_file = tmp_path / "dump.json"

    mock_popen = MagicMock()
    with patch("runtimed._sidecar.find_binary", return_value="/usr/bin/runt"), \
         patch("subprocess.Popen", return_value=mock_popen) as popen_call:
        sidecar(str(conn_file), dump=str(dump_file))

        cmd = popen_call.call_args[0][0]
        assert "--dump" in cmd
        assert str(dump_file) in cmd


def test_sidecar_missing_connection_file(tmp_path):
    """Error when connection file does not exist."""
    with patch("runtimed._sidecar.find_binary", return_value="/usr/bin/runt"):
        with pytest.raises(FileNotFoundError, match="not found"):
            sidecar(str(tmp_path / "nonexistent.json"))


def test_sidecar_auto_detect_no_ipykernel():
    """Error when ipykernel not installed and no connection file given."""
    with patch.dict("sys.modules", {"ipykernel": None, "ipykernel.connect": None}):
        with pytest.raises(RuntimeError, match="ipykernel"):
            sidecar()
