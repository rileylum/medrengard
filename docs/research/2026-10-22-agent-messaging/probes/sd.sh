#!/bin/bash
S=/var/tmp/software_factory/agent-messaging-research/scratch
NODEB=$(readlink -f $(which node))
$NODEB -e 'require("net").createServer(s=>{s.end("host-ok\n")}).listen(18080,"127.0.0.1")' & L=$!
$NODEB -e 'require("net").createServer(s=>{s.end("abs-ok\n")}).listen("\0sf-probe-abs")' & A=$!
sleep 0.5
for P in "IPAddressDeny=any" "PrivateNetwork=yes" "RestrictAddressFamilies=AF_INET AF_INET6" "SocketBindDeny=any"; do
 echo "== scope -p $P"; systemd-run --user --scope -q -p "$P" $NODEB $S/client.js 2>&1 | head -4
 echo "== service --wait --pipe -p $P"; systemd-run --user --wait --pipe -q -p "$P" $NODEB $S/client.js 2>&1 | head -4
done
kill $L $A
