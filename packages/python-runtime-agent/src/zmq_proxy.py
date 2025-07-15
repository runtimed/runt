import sys
import argparse
import zmq
import base64
import json
import traceback

# Parse arguments
parser = argparse.ArgumentParser(description="Proxy a Jupyter ZMQ channel via stdin/stdout.")
parser.add_argument("--role", required=True, help="ZMQ socket role: dealer, sub, req, etc.")
parser.add_argument("--connect", required=True, help="ZMQ connection string, e.g. tcp://127.0.0.1:5555")
args = parser.parse_args()

role = args.role.lower()
address = args.connect

context = zmq.Context()
socket = context.socket(getattr(zmq, role.upper()))

if role == "sub":
    socket.connect(address)
    socket.setsockopt(zmq.SUBSCRIBE, b"")  # Subscribe to all messages
else:
    socket.connect(address)

def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            cmd = json.loads(line)
            if not isinstance(cmd, list) or len(cmd) < 2:
                sys.stderr.write(f"[error] Invalid command: {cmd}\n")
                sys.stderr.flush()
                continue
            action = cmd[0]
            req_id = cmd[1]
            if action == "read":
                try:
                    msg = socket.recv_multipart()
                    encoded = [base64.b64encode(part).decode("ascii") for part in msg]
                    out = ["read_complete", req_id] + encoded
                    sys.stderr.write(f"[zmq->stdout] {json.dumps(out)}\n")
                    sys.stderr.flush()
                    sys.stdout.write(json.dumps(out) + "\n")
                    sys.stdout.flush()
                except Exception as e:
                    sys.stderr.write(f"[zmq->stdout] Error: {str(e)}\n")
                    traceback.print_exc(file=sys.stderr)
                    sys.stderr.flush()
            elif action == "write":
                try:
                    frames = [base64.b64decode(part) for part in cmd[2:]]
                    socket.send_multipart(frames)
                    out = ["write_complete", req_id]
                    sys.stderr.write(f"[stdin->zmq] {json.dumps(out)}\n")
                    sys.stderr.flush()
                    sys.stdout.write(json.dumps(out) + "\n")
                    sys.stdout.flush()
                except Exception as e:
                    sys.stderr.write(f"[stdin->zmq] Error: {str(e)}\n")
                    traceback.print_exc(file=sys.stderr)
                    sys.stderr.flush()
            else:
                sys.stderr.write(f"[error] Unknown action: {action}\n")
                sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[main] Error: {str(e)}\n")
            traceback.print_exc(file=sys.stderr)
            sys.stderr.flush()
            break

if __name__ == "__main__":
    main() 
