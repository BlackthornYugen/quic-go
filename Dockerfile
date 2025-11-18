# syntax = docker/dockerfile:1.3
FROM node:22-alpine AS node-deps

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev && \
    mkdir -p httpbin/static && \
    cp node_modules/tabulator-tables/dist/js/tabulator.min.js httpbin/static/ && \
    cp node_modules/tabulator-tables/dist/css/tabulator.min.css httpbin/static/

FROM golang:1.24 AS build

WORKDIR /go/src/github.com/mccutchen/go-httpbin

COPY . .
COPY --from=node-deps /app/httpbin/static/tabulator.min.js httpbin/static/
COPY --from=node-deps /app/httpbin/static/tabulator.min.css httpbin/static/

RUN --mount=type=cache,id=gobuild,target=/root/.cache/go-build \
    make build buildtests

FROM gcr.io/distroless/static:nonroot

COPY --from=build /go/src/github.com/mccutchen/go-httpbin/dist/go-httpbin* /bin/

EXPOSE 8080
CMD ["/bin/go-httpbin"]
