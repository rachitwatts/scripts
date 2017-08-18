function launch_env {
  playbook_runner="XXXXXX";
  playbook_name="YYYYYY";
  ansible_location=$HOME/loc/to/ansible;
	
  cd $ansible_location;
	source ve/bin/activate;
	ips=($(./$playbook_runner -i environments/$1 $playbook_name --list-host | egrep "\b(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b" | awk '{$1=$1};1' | tr '\n' ' '));
	osascript -e 'on run ipList
        set vPaneList to {}
        tell application "iTerm2"
                tell current window
                        create tab with default profile
                end tell
                set beginning of vPaneList to current session of current window
        end tell
        repeat with a from 1 to (round (length of ipList) / 2 rounding up) - 1
                tell application "iTerm2"
                        tell current session of current window
                                set newSplit to (split vertically with same profile)
                                set end of vPaneList to newSplit
                        end tell
                end tell
        end repeat
        vPaneList
        set hPaneList to {}
        repeat with a from 1 to (round (length of ipList) / 2 rounding down)
                tell application "iTerm2"
                        tell item a of vPaneList
                                set newSplit to (split horizontally with same profile)
                                set end of hPaneList to newSplit
                        end tell
                end tell
        end repeat
        hPaneList
        set allPaneList to vPaneList & hPaneList
        allPaneList

        repeat with a from 1 to length of allPaneList
                set singlePane to item a of allPaneList
                tell application "iTerm2"
                        tell singlePane
                                write text "ssh -p1278 " & (item a of ipList)
                        end tell
                end tell
        end repeat
	end run' $ips;

}
