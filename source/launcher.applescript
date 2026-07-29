on run
	set appPath to POSIX path of (path to me)
	if appPath ends with "/" then set appPath to text 1 thru -2 of appPath
	set rootPath to do shell script "/usr/bin/dirname " & quoted form of appPath
	set launcherPath to rootPath & "/start.command"

	try
		do shell script "/usr/bin/test -x " & quoted form of launcherPath
	on error
		display alert "灵妆" message "启动器旁边缺少 start.command。请保留整个灵妆发行文件夹。" as critical
		return
	end try

	do shell script "/usr/bin/nohup /bin/bash " & quoted form of launcherPath & " >/dev/null 2>&1 </dev/null &"
end run
