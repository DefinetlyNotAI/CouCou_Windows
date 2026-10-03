$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName System.Speech
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    switch ($request.mode) {
        'capabilities' {
            $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
            try {
                $voices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name })
                $languages = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name })
                @{ voices = $voices; languages = $languages } | ConvertTo-Json -Compress
            } finally { $speaker.Dispose() }
        }
        'listen' {
            $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
            try {
                $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
                $recognizer.SetInputToDefaultAudioDevice()
                $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(10)
                $result = $recognizer.Recognize([TimeSpan]::FromSeconds(15))
                if ($null -eq $result) { throw 'No speech detected. Check your microphone and try again.' }
                @{ text = $result.Text } | ConvertTo-Json -Compress
            } finally { $recognizer.Dispose() }
        }
        'speak' {
            $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
            try {
                $speaker.SetOutputToDefaultAudioDevice()
                $speaker.Volume = [int]$request.volume
                $speaker.Speak([string]$request.text)
                @{ text = '' } | ConvertTo-Json -Compress
            } finally { $speaker.Dispose() }
        }
        default { throw 'Unknown voice operation.' }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
