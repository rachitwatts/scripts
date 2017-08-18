# ------------------------------------------------------------------------------------------------------------
# git commands
# ------------------------------------------------------------------------------------------------------------
alias st="git status"
alias diff="git diff"
alias log="git log"
alias co="git checkout"
alias pull="git pull origin"
alias push="git push origin"
alias commit="git commit -m"
# alias add="git add ."
alias merge="git merge"
alias branch="git branch"
alias stash="git stash"
alias fetch="git fetch"
alias gitpurge="git branch --merged | grep -v \"\*\" | grep -v \"master\" | xargs -n 1 git branch -d"

function add {
	if [ -z $1 ]
	then
		git add .;
	else
		git add $1;
	fi
}

function pr {
	currentBranch=$(git branch | grep '^*' | sed 's/* //');
	repoPath=$(currentRepoPath);
	createPR $currentBranch $repoPath $1;
}

function pushpr {
	currentBranch=$(git branch | grep '^*' | sed 's/* //');
	repoPath=$(currentRepoPath);
	git push origin $currentBranch;
	createPR $currentBranch $repoPath $1;
}

function createPR {
	if [ -z $3 ]
	then
		echo "Raising PR on development branch";
		open https://github.com/$2/compare/development...$1\?expand\=1;
	else
		echo "Raising PR on $1 branch";
		open https://github.com/$2/compare/$3...$1\?expand\=1;
	fi
}

function currentRepoPath {
	local remotePath=$(git config --get remote.origin.url);
	local startIndex=0;
	if [[ $remotePath == git* ]]
	then
		startIndex=16;
	else
		startIndex=20;
	fi 
	echo $remotePath | cut -c$startIndex- | rev | cut -c5- | rev;
}