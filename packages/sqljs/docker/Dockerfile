FROM emscripten/emsdk:5.0.0 AS source

RUN apt-get update \
  && apt-get install --yes --no-install-recommends default-jre-headless git libdigest-sha3-perl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --branch v1.14.2 --depth 1 https://github.com/sql-js/sql.js.git .
RUN test "$(git rev-parse HEAD)" = "9c4e167ec37129192d166ab9223faa9a4bd07c58"
COPY docker/sqljs-reliability.patch /tmp/sqljs-reliability.patch
RUN patch -p1 < /tmp/sqljs-reliability.patch

FROM source AS full
RUN make dist/sql-wasm.js dist/sql-wasm-browser.js

FROM source AS lite
COPY docker/sqljs-lite.patch /tmp/sqljs-lite.patch
RUN patch -p1 < /tmp/sqljs-lite.patch \
  && make dist/sql-wasm.js

FROM source AS artifacts
COPY --from=full /build/dist/sql-wasm.js /artifacts/sql-wasm.js
COPY --from=full /build/dist/sql-wasm.wasm /artifacts/sql-wasm.wasm
COPY --from=full /build/dist/sql-wasm-browser.js /artifacts/sql-wasm-browser.js
COPY --from=full /build/dist/sql-wasm-browser.wasm /artifacts/sql-wasm-browser.wasm
COPY --from=lite /build/dist/sql-wasm.js /artifacts/sql-wasm-lite.js
COPY --from=lite /build/dist/sql-wasm.wasm /artifacts/sql-wasm-lite.wasm

CMD ["sh", "-c", "cp /artifacts/* /output/"]
