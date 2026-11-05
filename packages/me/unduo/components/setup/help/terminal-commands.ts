/**
 * Shell commands that do what the setup page does, with curl, openssl and
 * python3 and none of unduo's code. The root README shows the same blocks, and
 * `__tests__` runs them against a local stand-in for Duo.
 *
 * The blocks have no `#` comments: zsh, macOS's default shell, runs a pasted
 * `# …` line as a command unless `interactivecomments` is set.
 */
export const terminalCommands = {
  /** Example values, which the user replaces with their QR code's. */
  values: String.raw`host=api-XXXXXXXX.duosecurity.com
code=ABCDE12345`,
  /**
   * One POST with a new public key and Duo Mobile's device details: the same
   * fields as the page's Duo form. openssl's private key is never saved.
   */
  activate: String.raw`pubkey=$(openssl genrsa 2048 | openssl rsa -pubout)
reply=$(curl -sS "https://$host/push/v2/activation/$code?customer_protocol=1" -A okhttp/2.7.5 \
  --data-urlencode "pubkey=$pubkey" -d pkpush=rsa-sha512 \
  -d platform=Android -d version=13 -d manufacturer=Google -d model=Cheetah \
  -d app_id=com.duosecurity.duomobile -d app_version=4.33.0 -d app_build_number=433000 \
  -d architecture=arm64 -d jailbroken=false -d full_disk_encryption=true -d passcode_status=true \
  -d security_patch_level=2024-01-01 -d region=US -d language=en)`,
  /** Reads Duo's reply locally and prints the base32 key and its otpauth link. */
  account: String.raw`printf %s "$reply" | python3 -c '
import base64, json, sys, urllib.parse
reply = json.load(sys.stdin)
if reply.get("stat") != "OK": sys.exit("Duo said: %s" % reply.get("message"))
key = base64.b32encode(reply["response"]["hotp_secret"].encode()).decode().rstrip("=")
name = urllib.parse.quote(reply["response"]["customer_name"], safe="")
print("Key:", key)
print(f"otpauth://hotp/Duo:{name}?secret={key}&issuer=Duo&algorithm=SHA1&digits=6&counter=0")'`,
};
