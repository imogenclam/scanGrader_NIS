"""Сквозная проверка учебной сдачи через HTTP. Зависимости входят в Python."""

import argparse
import json
import subprocess
import sys
from contextlib import closing
from datetime import datetime
from functools import partial
from http.client import HTTPConnection, HTTPException, HTTPSConnection
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
SUBMISSION = "/api/submissions/1"
APPROVE = SUBMISSION + "/approve"


def check(condition, message):
    if not condition:
        raise ValueError(message)


def command(args, cwd=None):
    result = subprocess.run(args, cwd=cwd, capture_output=True, check=True,
                            encoding="utf-8", timeout=30)
    return result.stdout.strip()


def request(base, method, path, expected, token=None, payload=None):
    headers = {}
    body = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    connection = HTTPSConnection if base.scheme == "https" else HTTPConnection
    with closing(connection(base.netloc, timeout=10)) as conn:
        conn.request(method, base.path.rstrip("/") + path, body=body, headers=headers)
        response = conn.getresponse()
        print(f"{method} {path}  HTTP {response.status}")
        check(response.status == expected, f"Ожидался HTTP {expected}")
        check(response.headers.get_content_type() == "application/json", "Ожидался ответ JSON")
        check(response.getheader("Cache-Control") == "no-store", "Нет Cache-Control no-store")
        if expected == 401:
            check(response.getheader("WWW-Authenticate") == "Bearer", "Нет WWW-Authenticate Bearer")
        data = json.load(response)
    if expected >= 400:
        check(isinstance(data, dict) and set(data) == {"error"} and data["error"],
              "Ожидалось сообщение об ошибке")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", help="Адрес запущенного учебного API")
    parser.add_argument("--binary", help="Путь к scangrader для получения токенов из той же SG_DATA_DIR")
    parser.add_argument("--expect-approved", action="store_true",
                        help="Требовать уже утверждённую сдачу сразу после запуска")
    parser.add_argument("--result-file", type=Path, help="Записать студенческий итог в JSON UTF-8")
    args = parser.parse_args()
    compose = ["docker", "compose"]
    base_url = args.base_url
    if not base_url:
        address = "127.0.0.1:8080" if args.binary else command(compose + ["port", "app", "8080"], ROOT)
        base_url = "http://" + address
    base = urlsplit(base_url)
    check(base.scheme in {"http", "https"} and base.hostname, "Требуется URL с http или https")
    call = partial(request, base)
    check(call("GET", "/healthz", 200) == {"status": "ok"}, "SQLite недоступна")

    cli = [args.binary] if args.binary else compose + ["exec", "-T", "app", "scangrader"]
    cwd = None if args.binary else ROOT
    teacher = command(cli + ["token", "teacher"], cwd)
    student = command(cli + ["token", "student"], cwd)
    check(teacher and student and teacher != student, "Не удалось получить токены двух учебных ролей")
    example = json.loads((ROOT / "docs/api/examples/approve.json").read_text(encoding="utf-8"))

    call("GET", SUBMISSION, 401)
    call("POST", APPROVE, 403, student, example)
    teacher_view = call("GET", SUBMISSION, 200, teacher)
    student_view = call("GET", SUBMISSION, 200, student)
    if args.expect_approved:
        check(teacher_view.get("status") == "approved", "Ожидалась ранее утверждённая работа")
    draft = [{"number": 1, "score": 0.5, "comment": "Проверьте вычисление."}]
    check(teacher_view.get("tasks") == [{"number": 1, "max": 1}] and teacher_view.get("draft") == draft,
          "Сценарию нужна учебная сдача № 1 с исходным черновиком")
    print("Черновик преподавателя", json.dumps(draft, ensure_ascii=False))

    invalid = {"grades": [{**example["grades"][0], "score": 1.2}]}
    error = call("POST", APPROVE, 400, teacher, invalid)
    check(error["error"] == "проверьте оценку: для задачи 1 укажите балл от 0 до 1",
          "Ожидалась ошибка о максимуме задачи 1")
    print(error["error"])
    check(call("GET", SUBMISSION, 200, student) == student_view, "Отклонённый балл изменил ответ студенту")

    if teacher_view["status"] == "pending_review":
        check(student_view == {"id": 1, "status": "pending_review"}, "Неверный ответ студенту до утверждения")
        print("Студент до утверждения", json.dumps(student_view, ensure_ascii=False))
        final = call("POST", APPROVE, 200, teacher, example)
        check(final.get("grades") == example["grades"], "Сохранённые баллы отличаются от отправленных")
    else:
        check(teacher_view["status"] == "approved", "Неизвестный статус учебной сдачи")
        print("Работа уже утверждена. Проверяем сохранённый результат.")
        final = student_view

    check(set(final) == {"id", "status", "grades", "total", "approved_by", "approved_at"},
          "Неверный набор полей опубликованного результата")
    check(final["id"] == 1 and final["status"] == "approved" and final["approved_by"] == "teacher-demo",
          "Неверные реквизиты утверждения")
    check(len(final["grades"]) == 1 and final["total"] == final["grades"][0]["score"], "Неверная сумма")
    check(final["approved_at"].endswith("Z"), "Ожидалось время утверждения в UTC")
    datetime.fromisoformat(final["approved_at"][:-1] + "+00:00")

    call("POST", APPROVE, 409, teacher, example)
    student_final = call("GET", SUBMISSION, 200, student)
    check(student_final == final, "Результат студента изменился при повторе")
    check(call("GET", SUBMISSION, 200, teacher) == {**final, "tasks": teacher_view["tasks"], "draft": draft},
          "Ответ преподавателю должен содержать исходный черновик и сохранённый итог")
    print("Опубликованный результат", json.dumps(student_final, ensure_ascii=False))
    if args.result_file:
        canonical = json.dumps(student_final, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        args.result_file.write_bytes((canonical + "\n").encode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, HTTPException, subprocess.SubprocessError) as exc:
        sys.exit(f"Демонстрация прервана. {exc}")
