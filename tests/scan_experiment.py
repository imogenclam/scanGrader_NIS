"""Проверяет распознавание двух изображений и обмен с локальным адаптером оценки."""
import argparse
import json
import subprocess
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

FIXTURES = Path(__file__).with_name("testdata")
CASES = {"2+2=4": (1, "Верно"), "2+2=5": (0, "Проверьте сумму")}


def read_scan(pdf, working_dir, dpi):
    prefix = working_dir / pdf.stem
    subprocess.run(
        ["pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-r", str(dpi), "-gray", "-png",
         str(pdf), str(prefix)], check=True, timeout=20,
    )
    run = subprocess.run(
        ["tesseract", str(prefix.with_suffix(".png")), "stdout", "-l", "eng", "--psm", "7",
         "-c", "tessedit_char_whitelist=0123456789+="],
        check=True, capture_output=True, timeout=20, text=True,
    )
    return "".join(run.stdout.split())


class FixtureModel(BaseHTTPRequestHandler):
    """Локальный двойник HTTP-сервиса, принимающий только подготовленные примеры."""
    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        message = json.loads(body["messages"][0]["content"])
        if message.get("reference_tex") != self.server.reference or message.get("transcript") not in CASES:
            self.send_error(422)
            return
        score, comment = CASES[message["transcript"]]
        output = {"grades": [{"number": 1, "score": score, "comment": comment}]}
        reply = {"choices": [{"message": {"content": json.dumps(output, ensure_ascii=False)}}]}
        data = json.dumps(reply, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def request_draft(endpoint, transcript, reference):
    evidence = json.dumps({"transcript": transcript, "reference_tex": reference}, ensure_ascii=False)
    body = {"model": "local-fixture", "messages": [{"role": "user", "content": evidence}]}
    request = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        reply = json.load(response)
    return json.loads(reply["choices"][0]["message"]["content"])["grades"]


def run(dpi):
    reference = (FIXTURES / "reference.tex").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as temp, HTTPServer(("127.0.0.1", 0), FixtureModel) as server:
        server.reference = reference
        listener = threading.Thread(target=server.serve_forever, daemon=True)
        listener.start()
        try:
            endpoint = f"http://127.0.0.1:{server.server_port}/v1/chat/completions"
            for name, expected, score in [("four.pdf", "2+2=4", 1), ("five.pdf", "2+2=5", 0)]:
                transcript = read_scan(FIXTURES / name, Path(temp), dpi)
                if transcript != expected:
                    raise AssertionError(f"{name}: OCR returned {transcript!r}, expected {expected!r}")
                grades = request_draft(endpoint, transcript, reference)
                if len(grades) != 1 or grades[0]["number"] != 1 or grades[0]["score"] != score:
                    raise AssertionError(f"{name}: unexpected draft {grades!r}")
                print(f"{name} ({dpi} dpi): OCR={transcript}; fixture_grade={score}/1", flush=True)
        finally:
            server.shutdown()
            listener.join()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dpi", type=int, choices=(144, 180), default=144,
                        help="144 сохраняет исходный растр, 180 воспроизводит контрольный опыт")
    run(parser.parse_args().dpi)
