# serve.ps1
# Zero-dependency static file server for Windows PowerShell.
# Usage:
#   1. Place this script inside the "app" folder (next to index.html).
#   2. Right-click serve.ps1 -> "Run with PowerShell"
#      (or open PowerShell in this folder and run:  .\serve.ps1 )
#   3. Open http://localhost:8000 in your browser.
#   4. Press Ctrl+C in the PowerShell window to stop the server.
#
# If Windows blocks the script from running, first run this once in an
# elevated PowerShell:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$port = 8000
$root = $PSScriptRoot

$mime = @{
    ".html"     = "text/html; charset=utf-8"
    ".htm"      = "text/html; charset=utf-8"
    ".js"       = "application/javascript; charset=utf-8"
    ".mjs"      = "application/javascript; charset=utf-8"
    ".css"      = "text/css; charset=utf-8"
    ".json"     = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".png"      = "image/png"
    ".svg"      = "image/svg+xml"
    ".ico"      = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "Servering '$root' pa http://localhost:$port  (Ctrl+C for att avsluta)"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $requestedPath = $request.Url.AbsolutePath
        if ($requestedPath -eq "/") { $requestedPath = "/index.html" }
        $localPath = Join-Path $root ($requestedPath.TrimStart("/") -replace "/", [IO.Path]::DirectorySeparatorChar)

        if (Test-Path $localPath -PathType Leaf) {
            $ext = [IO.Path]::GetExtension($localPath).ToLower()
            $contentType = $mime[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }

            $bytes = [IO.File]::ReadAllBytes($localPath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $notFound = [Text.Encoding]::UTF8.GetBytes("404 - hittades inte: $requestedPath")
            $response.OutputStream.Write($notFound, 0, $notFound.Length)
        }
        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
