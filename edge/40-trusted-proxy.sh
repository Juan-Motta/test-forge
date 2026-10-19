#!/bin/sh
# Writes /tmp/edge.d/trusted-proxy.conf when TRUSTED_PROXY_CIDR is set (compose.dokploy.yaml),
# so the edge recovers the client address from that proxy only. Unset: nothing is written and
# the edge stays the first hop. /tmp is the only writable path (read-only root filesystem).
set -eu

mkdir -p /tmp/edge.d
conf=/tmp/edge.d/trusted-proxy.conf
rm -f "$conf"

cidr="${TRUSTED_PROXY_CIDR:-}"
[ -n "$cidr" ] || exit 0

case "$cidr" in
    *[!0-9a-fA-F.:/]* | */*/* | 0.0.0.0/0 | ::/0)
        echo "$0: TRUSTED_PROXY_CIDR must be one address or subnet, not '$cidr'" >&2
        # nginx refuses to start on this line, so a bad value never runs untrusted.
        echo "invalid_trusted_proxy_cidr;" > "$conf"
        exit 1
        ;;
esac

printf 'set_real_ip_from %s;\nreal_ip_header   X-Forwarded-For;\nreal_ip_recursive on;\n' \
    "$cidr" > "$conf"
echo "$0: trusting X-Forwarded-For from $cidr"
