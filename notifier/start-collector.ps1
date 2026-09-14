$collectorPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/pythonw.exe'
if (!(Test-Path -LiteralPath $collectorPython)) { $collectorPython = (Get-Command pythonw.exe -ErrorAction Stop).Source }
Start-Process -FilePath $collectorPython -ArgumentList ('"' + (Join-Path $PSScriptRoot 'collector.py') + '"') -WorkingDirectory (Split-Path $PSScriptRoot) -WindowStyle Hidden
