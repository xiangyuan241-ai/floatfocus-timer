Option Explicit

Dim shell, fso, scriptDir, projectDir, electronCmd, comspec, command, q

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

q = Chr(34)
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
electronCmd = fso.BuildPath(projectDir, "node_modules\.bin\electron.cmd")
comspec = shell.ExpandEnvironmentStrings("%ComSpec%")

shell.CurrentDirectory = projectDir

If fso.FileExists(electronCmd) Then
    command = q & comspec & q & " /d /s /c " & q & q & electronCmd & q & " " & q & projectDir & q & q
Else
    command = q & comspec & q & " /d /s /c " & q & "npm start" & q
End If

shell.Run command, 0, False
