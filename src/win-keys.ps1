# Started once by src/keys.js and kept open. Reads one request per line on stdin:
#     <id> TAB <window title> TAB <keys>
# brings that window to the front, sends the keys if any, and answers on stdout:
#     <id> TAB sent | focused | nofocus | error
# A fourth field, confirm-effort, sends no keys. It presses the menu item that has keyboard focus,
# but only if that item's name is an effort level, and answers confirmed or unverified.
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

$automationReady = $true
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch { $automationReady = $false }

# Presses the focused element through UI Automation, and only when it is plainly an effort choice.
# It never sends a key, so it cannot confirm anything else that happens to have focus.
function Confirm-Effort([IntPtr]$h) {
  if (-not $automationReady) { return 'unverified' }
  if ([AgentPad.Native]::GetForegroundWindow() -ne $h) { return 'unverified' }
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $el) { return 'unverified' }
  $name = [string]$el.Current.Name
  if ($name -notmatch '^\s*(low|medium|high|x-?high|extra[ -]?high|max)\b') { return 'unverified' }
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return 'confirmed' }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return 'confirmed' }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $p.Toggle(); return 'confirmed' }
  return 'unverified'
}

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
    $mode = ''
    if ($parts.Length -gt 3) { $mode = $parts[3] }
    if ($mode -eq 'confirm-effort') {
      $h = Find-Window $parts[1]
      if ($h -eq [IntPtr]::Zero) { $result = 'nofocus' } else { $result = Confirm-Effort $h }
    }
    elseif (-not (Focus-Window $parts[1])) { $result = 'nofocus' }
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
