// Highlights the last two IP octets (e.g. "8.124" in "192.168.8.124:5555")
// — with dozens of devices on the same subnet, that's the part people
// actually read to tell devices apart.
const IP_SERIAL_RE = /^(\d+\.\d+\.)(\d+\.\d+)(:\d+)?$/;

export function highlightSerial(serial: string) {
  const m = IP_SERIAL_RE.exec(serial);
  if (!m) return serial;
  return (
    <>
      {m[1]}
      <span className="font-bold text-sky-400">{m[2]}</span>
      {m[3] ?? ""}
    </>
  );
}

/** Just the last two IP octets as plain text (e.g. "8.124"), for appending
 * next to a device note badge instead of highlighting inline in the serial. */
export function ipSuffix(serial: string): string | null {
  const m = IP_SERIAL_RE.exec(serial);
  return m ? m[2] : null;
}
