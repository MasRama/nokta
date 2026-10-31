# Shows a toast as another app would, here Windows PowerShell, so the
# smoke sees Nokta read it from Windows' notification database. Needs
# Windows PowerShell 5.1 (powershell.exe), which has the WinRT types.
# CI runs it on windows-latest after Nokta starts.
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(@'
<toast>
  <visual><binding template="ToastGeneric"><text>Rani</text><text>Sudah sampai stasiun &amp; nunggu di depan</text></binding></visual>
  <actions><action content="Reply" arguments="reply"/><action content="Later" arguments="later" activationType="background"/></actions>
</toast>
'@)
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show((New-Object Windows.UI.Notifications.ToastNotification $xml))
