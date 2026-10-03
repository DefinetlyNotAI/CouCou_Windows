$ErrorActionPreference='Stop'
$r=[Console]::In.ReadToEnd() | ConvertFrom-Json
$base=([string]$r.endpoint).TrimEnd('/')
$target=$null
$socket=$null
try {
  $target=Invoke-RestMethod -Method Put -Uri ($base+'/json/new?'+[Uri]::EscapeDataString([string]$r.url)) -TimeoutSec 10
  $socket=New-Object System.Net.WebSockets.ClientWebSocket
  $cancel=New-Object System.Threading.CancellationTokenSource
  $cancel.CancelAfter(35000)
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl,$cancel.Token).GetAwaiter().GetResult()
  $expression=@'
(() => ({ready:document.readyState !== 'loading' && !!document.body && document.body.innerText.trim().length > 40,title:document.title,url:location.href,content:(document.body?.innerText || '').slice(0,16000),links:Array.from(document.querySelectorAll('a[href]')).filter(a=>/^https?:/.test(a.href)&&a.innerText.trim()).slice(0,30).map(a=>({title:a.innerText.trim().slice(0,200),url:a.href}))}))()
'@
  for($id=1;$id -le 25;$id++) {
    $message=@{id=$id;method='Runtime.evaluate';params=@{expression=$expression;returnByValue=$true}} | ConvertTo-Json -Depth 5 -Compress
    $bytes=[Text.Encoding]::UTF8.GetBytes($message)
    $socket.SendAsync([ArraySegment[byte]]::new($bytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult()
    do {
      $stream=New-Object IO.MemoryStream
      do {
        $buffer=New-Object byte[] 65536
        $part=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult()
        if($part.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){throw 'Browser closed the debugging connection'}
        $stream.Write($buffer,0,$part.Count)
      } while(-not $part.EndOfMessage)
      $reply=[Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
      $stream.Dispose()
    } while($reply.id -ne $id)
    if($reply.error){throw $reply.error.message}
    if($reply.result.exceptionDetails){throw 'Browser page extraction failed'}
    $value=$reply.result.result.value
    if($value.ready){$value | ConvertTo-Json -Depth 8 -Compress;exit 0}
    Start-Sleep -Milliseconds 500
  }
  throw 'Page did not become readable within the browser timeout'
} finally {
  if($socket){$socket.Dispose()}
  if($cancel){$cancel.Dispose()}
  if($target){try {Invoke-RestMethod -Uri ($base+'/json/close/'+$target.id) -TimeoutSec 3 | Out-Null} catch {}}
}
