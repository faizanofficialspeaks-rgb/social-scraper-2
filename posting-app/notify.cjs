const { execFile } = require('child_process');

const SCRIPT = (title, message) => `
Add-Type -AssemblyName System.Windows.Forms;
$n = New-Object System.Windows.Forms.NotifyIcon;
$n.Icon = [System.Drawing.SystemIcons]::Information;
$n.Visible = $true;
$n.BalloonTipTitle = '${title}';
$n.BalloonTipText = '${message}';
$n.ShowBalloonTip(8000);
Start-Sleep -Seconds 10;
$n.Dispose()`;

function notify(title, message) {
  const safe = s => String(s).replace(/'/g, "''").slice(0, 220);
  const cmd = SCRIPT(safe(title), safe(message));
  const encoded = Buffer.from(cmd, 'utf16le').toString('base64');
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true }, err => {
    if (err) console.error('[NOTIFY] failed:', err.message);
  });
}

module.exports = { notify };