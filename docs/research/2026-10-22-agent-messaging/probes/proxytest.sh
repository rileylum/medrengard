#!/bin/bash
NODEB=$(readlink -f $(which node))
# tiny CONNECT proxy logger on 18081: replies 403 to everything, logs request line
$NODEB -e 'require("net").createServer(s=>{s.once("data",d=>{console.log("proxy saw:",d.toString().split("\r\n")[0]);s.end("HTTP/1.1 403 Forbidden\r\n\r\n")})}).listen(18081,"127.0.0.1")' & PX=$!
sleep 0.4
T='fetch("https://api.anthropic.com/").then(r=>console.log("fetch status",r.status)).catch(e=>console.log("fetch err",e.cause?.code||e.message))'
echo "== env only"; HTTPS_PROXY=http://127.0.0.1:18081 timeout 5 $NODEB -e "$T"
echo "== env + NODE_USE_ENV_PROXY=1"; NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:18081 timeout 5 $NODEB -e "$T"
echo "== https.get + NODE_USE_ENV_PROXY=1"; NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:18081 timeout 5 $NODEB -e 'require("https").get("https://api.anthropic.com/",r=>console.log("https status",r.statusCode)).on("error",e=>console.log("https err",e.code||e.message))'
echo "== unix socket proxy URL?"; NODE_USE_ENV_PROXY=1 HTTPS_PROXY=unix:///tmp/x.sock timeout 5 $NODEB -e "$T" 2>&1 | head -3
kill $PX
