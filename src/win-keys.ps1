# Started once by src/keys.js and kept open. Reads one request per line on stdin:
#     <id> TAB <window title> TAB <keys>
# brings that window to the front, sends the keys if any, and answers on stdout:
#     <id> TAB sent | focused | nofocus | error
# To try it by hand:  powershell -ExecutionPolicy Bypass -File src\win-keys.ps1
# then type a line such as   1<TAB>Claude<TAB>^n   and press Enter.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace AgentPad -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@

function Find-Window([string]$title) {
  $all = @(Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle })
  $hit = $all | Where-Object { $_.MainWindowTitle -eq $title } | Select-Object -First 1
  if (-not $hit) { $hit = $all | Where-Object { $_.MainWindowTitle -like "$title*" } | Select-Object -First 1 }
  if (-not $hit) { $hit = $all | Where-Object { $_.MainWindowTitle -like "*$title" } | Select-Object -First 1 }
  if ($hit) { return $hit.MainWindowHandle }
  return [IntPtr]::Zero
}

function Focus-Window([string]$title) {
  $h = Find-Window $title
  if ($h -eq [IntPtr]::Zero) { return $false }
  if ([AgentPad.Native]::GetForegroundWindow() -eq $h) { return $true }
  if ([AgentPad.Native]::IsIconic($h)) { [void][AgentPad.Native]::ShowWindowAsync($h, 9) }
  # Windows only lets a background program take focus straight after keyboard input.
  # Two taps of Alt count as input, and the second tap cancels the menu the first would open.
  foreach ($n in 1..2) {
    [AgentPad.Native]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [AgentPad.Native]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  }
  [void][AgentPad.Native]::SetForegroundWindow($h)
  foreach ($n in 1..12) {
    if ([AgentPad.Native]::GetForegroundWindow() -eq $h) { return $true }
    Start-Sleep -Milliseconds 30
  }
  return $false
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split("`t")
  $id = $parts[0]
  $result = 'error'
  try {
    if (-not (Focus-Window $parts[1])) { $result = 'nofocus' }
    elseif ($parts.Length -gt 2 -and $parts[2]) {
      Start-Sleep -Milliseconds 90
      [System.Windows.Forms.SendKeys]::SendWait($parts[2])
      $result = 'sent'
    }
    else { $result = 'focused' }
  } catch { $result = 'error' }
  [Console]::Out.WriteLine($id + "`t" + $result)
  [Console]::Out.Flush()
}
