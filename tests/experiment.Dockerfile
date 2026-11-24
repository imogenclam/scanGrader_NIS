FROM python:3.12-slim-bookworm@sha256:44cf1793efa7c7a476bb0f2cff81443f4a072c90c1cb127e2924933daa3e8c64
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils=22.12.0-2+deb12u3 tesseract-ocr=5.3.0-2 tesseract-ocr-eng=1:4.1.0-2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /experiment
COPY tests/scan_experiment.py ./
COPY tests/testdata/ ./testdata/
USER 65534:65534
ENTRYPOINT ["python", "scan_experiment.py"]
