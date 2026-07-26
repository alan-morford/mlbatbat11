var GameFlags = {};
   
GameFlags.isBeforeGameStart= function(game){
    return  GameFlags.getStatusInd(game) =="S" || GameFlags.getStatusInd(game).charAt(0)=='D' || GameFlags.getStatusInd(game).charAt(0)=='C' ||(GameFlags.getStatusInd(game).charAt(0) == 'P' && GameFlags.getStatusInd(game)!="PW");
};
GameFlags.isDuringGame= function(game) {
    return GameFlags.getStatusInd(game) =="PW" || GameFlags.getStatusInd(game).charAt(0) == 'I' || GameFlags.getStatusInd(game).charAt(0)=="U";
};
GameFlags.isAfterGameEnd= function(game) {
    return GameFlags.getStatusInd(game).charAt(0) =="O" || GameFlags.getStatusInd(game).charAt(0) == 'F';
};
GameFlags.isSuspended= function(game) {
    return GameFlags.getStatusInd(game).charAt(0)=="U" || GameFlags.getStatusInd(game).charAt(0)=="T";
};
GameFlags.getStatusInd= function(game) {
    if(game.status_ind) {
        return game.status_ind;
    }
    else {
        return game.status.ind;
    }
};

