// Parses MLB Stats API's schedule response with hydrate=broadcasts (see
// lib/WebServices.js's ScoreboardBroadcastsAPIService) into the game+feed
// list views/AudioView.js needs. Mirrors ScoreboardParser.js's shape/style;
// kept separate since the two hydrates serve different views and neither
// needs the other's fields.
var BroadcastsParser = {};

// Only AM/FM entries are radio; TV broadcasts appear in the same array and
// aren't playable by this feature. availableForStreaming filters out
// blacked-out/rights-restricted broadcasts (still listed, just not usable).
BroadcastsParser.isRadioFeed = function (broadcast) {
	return (broadcast.type === "AM" || broadcast.type === "FM")
		&& broadcast.availableForStreaming
		&& !!broadcast.mediaId;
};

BroadcastsParser.parseFeed = function (broadcast) {
	return {
		mediaId: broadcast.mediaId,
		callSign: broadcast.callSign || broadcast.name || broadcast.type,
		type: broadcast.type,
		language: broadcast.language || "en",
		// homeAway isn't present on every broadcast entry (some are
		// national/neutral); leave undefined rather than guessing a side.
		homeAway: broadcast.homeAway
	};
};

BroadcastsParser.parseGame = function (game) {
	var status = game.status || {};
	var abstractState = status.abstractGameState || "";
	var awayTeam = (game.teams && game.teams.away && game.teams.away.team) || {};
	var homeTeam = (game.teams && game.teams.home && game.teams.home.team) || {};
	var broadcasts = game.broadcasts || [];
	var feeds = [];

	for (var i = 0; i < broadcasts.length; i++) {
		if (BroadcastsParser.isRadioFeed(broadcasts[i])) {
			feeds.push(BroadcastsParser.parseFeed(broadcasts[i]));
		}
	}

	return {
		gamePk: game.gamePk,
		gameDate: game.gameDate,
		status: {
			abstractGameState: abstractState,
			detailedState: status.detailedState || "",
			isFinal: abstractState === "Final",
			isLive: abstractState === "Live",
			isPreview: abstractState === "Preview"
		},
		awayAbbrev: awayTeam.abbreviation || "",
		homeAbbrev: homeTeam.abbreviation || "",
		feeds: feeds
	};
};

// Only returns games that actually have at least one playable radio feed --
// views/AudioView.js's list is "games with audio", not every game.
BroadcastsParser.parseGamesWithBroadcasts = function (json) {
	var dates = (json && json.dates) || [];
	var rawGames = dates.length > 0 ? dates[0].games : [];
	var games = [];

	for (var i = 0; i < rawGames.length; i++) {
		var game = BroadcastsParser.parseGame(rawGames[i]);
		if (game.feeds.length > 0) {
			games.push(game);
		}
	}

	return games;
};
