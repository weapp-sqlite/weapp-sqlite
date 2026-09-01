FROM emscripten/emsdk:5.0.0

RUN apt-get update \
  && apt-get install --yes --no-install-recommends default-jre-headless git libdigest-sha3-perl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --branch v1.14.2 --depth 1 https://github.com/sql-js/sql.js.git .
COPY docker/sqljs-lite.patch /tmp/sqljs-lite.patch
RUN patch -p1 < /tmp/sqljs-lite.patch \
  && make dist/sql-wasm.js

CMD ["sh", "-c", "cp dist/sql-wasm.js /output/sql-wasm-lite.js && cp dist/sql-wasm.wasm /output/sql-wasm-lite.wasm"]
