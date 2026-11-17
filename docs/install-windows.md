# Installing Cortex on Windows

Cortex is one executable with the UI baked in. There is no runtime, no Node, no
Python, and no Windows service.

## Install

1. Download `CortexSetup-<version>.exe` from
   [Releases](https://github.com/thijnperd/obsidian-cortex/releases).
2. Run it. Windows will say **Windows protected your PC** — the binary is
   unsigned. Choose **More info → Run anyway**.
3. The installer is per user: it does **not** ask for administrator rights, and
   it writes to `%LOCALAPPDATA%\Programs\Cortex`.
4. Leave **Start Cortex when I sign in** unchecked unless you want it.

The optional desktop shortcut and the Start Menu entry both run `cortex.exe app`,
so there is no console window.

### Portable instead

`cortex-windows-x86_64.zip` contains `cortex.exe`. Unpack it anywhere and run it;
`cortex` resolves from any terminal that has the folder on `PATH`.

## Verify the download

Every release has a `SHA256SUMS.txt` beside the archives:

```powershell
Get-FileHash .\cortex-windows-x86_64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

The hashes must match. Code signing is not in place yet, so this is the only
integrity check the project can offer; GitHub build attestations need a public
repository.

## First run

Running `cortex` starts the app in the background and opens its window. On the
launch screen, **Browse…** opens the normal Windows folder picker; the path
field is there for network shares and other places the dialog cannot reach.

Cortex reads the folder in place. Nothing is copied or moved, and uninstalling
does not touch your notes.

## Where things live

| What | Path |
| --- | --- |
| Program | `%LOCALAPPDATA%\Programs\Cortex\cortex.exe` |
| Vault list and agent switches | `%APPDATA%\cortex\vaults.json` |
| Running instance | `%APPDATA%\cortex\server.json` |
| Log | `%APPDATA%\cortex\cortex.log` |
| Browser profile | `%APPDATA%\cortex\app-profile` |

Override the config location with `CORTEX_CONFIG_DIR` (useful for testing).

## Stopping it

- Close the window: the instance ends with it.
- Tray icon → **Quit Cortex**.
- `cortex stop` from a terminal, or `cortex doctor` to see what is running.

There is no `cortex.exe` in Task Manager named "server": the process is called
`cortex.exe`, and there should be exactly one.

## Troubleshooting

**Nothing opens.** Run `cortex app` in a terminal to see the output, or
`cortex doctor`; the log is at `%APPDATA%\cortex\cortex.log`. If no Chromium
browser (Edge, Chrome, Brave) is installed, Cortex falls back to your default
browser — closing that tab will not stop the instance.

**Port 3000 is busy.** Cortex takes the next free port and records it in
`server.json`; a second launch opens a window against the running instance. If
you need a fixed port: `cortex serve <folder> --port 4100`.

**The AI client does not see the server.** Run
`cortex mcp-config --vault "C:\path\to\vault" --write`, then fully restart the
client — most clients read their MCP config only at startup. In Vault settings →
AI clients, **Test connection** runs the same handshake the client will.
If agent access is off for that vault the test says so by name: turn it on in
the same panel, or run `cortex agents "C:\path\to\vault" --on`.

**Uninstall.** Settings → Apps → Cortex → Uninstall, or
`%LOCALAPPDATA%\Programs\Cortex\unins000.exe`. It removes the program and the
shortcuts; your vaults and the config folder stay, because they are yours.
Delete `%APPDATA%\cortex` if you want the remembered list gone too.
