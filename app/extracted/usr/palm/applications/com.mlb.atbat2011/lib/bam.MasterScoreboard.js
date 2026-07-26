(function (window, document, $, bam) {
  
  function addLeadingZeros (val, len) {
    val += '';
    while (val.length < (len || 2)) {
      val = '0' + val;
    }
    return val;
  }

  function makeJavaScriptUrl (code) {
    return 'javascript:void(' + escape(code) + ');';
  }
  
  function formatDateAsFEY (dateString) {
    return dateString.replace(formatDateAsFEY.regExp, '$2/$3/$1');
  }
  
  var MLB          = 'mlb', // Major League Baseball
      AL           = 'AL',  // American League
      NL           = 'NL',  // National League
      CL           = 'CL',  // Grapefruit League
      GL           = 'GL',  // Cactus League
      WBC          = 'WBC', // World Baseball Classic
      E            = 'E',   // Exhibiton
      
      mlbLeagueCodes = {       
        '103': AL,             
        '104': NL,             
        '114': CL,             
        '115': GL              
      },                       
      
      reExtendGameTime = /^(\d{4}\/\d{2}\/\d{2}).*$/,
      reHomeAway = /^(home|away)_(.*)$/,
      
      // comma, comma, comma, comma, comma chameleon
      dave = 'furf';


  /**
   * MasterScoreboard
   * If called without the new keyword, use a singleton instance.
   */
  var instance;

  function MasterScoreboard () {

	this.currentHost = (env.currentEnv==="PROD") ? "http://m.mlb.com/" : "http://wapqa.mlb.com/"; //dependency on /lib/Env.js

    if (!(this instanceof MasterScoreboard)) {
      if (!instance) {
        instance = new MasterScoreboard();
      }
      return instance;
    }
  }
  
  MasterScoreboard.prototype = {

    
    scoreUpdatedHash: {},
    runnersHash: {},
    
    epgSortOrder: {
      during: 1,
      before: 2,
      after:  3,
      nixed:  4,
      '':     5   // Handle possible error case
    },

	currentHost : "http://m.mlb.com/",

    /**
     * Augment game object with time data
     */
    extendGameTime: function (game, date) {

      // Add current and original dates
      game.current_date  = date;
      game.original_date = game.id.match(reExtendGameTime, '$1')[1];
      game.season        = game.original_date.substr(0, 4);
      
      // Start time to be determined (TBD)
      game.is_tbd        = (game.time === '3:33' && game.ampm === 'AM');
    },
    
    /**
     * Augment game object with game type booleans
     */
    extendGameType: function (game) {

      var gameType = game.game_type,
          type = {
            is_regular_season:  (gameType === 'R'),
            is_first_round:     (gameType === 'F'),
            is_division_series: (gameType === 'D'),
            is_league_series:   (gameType === 'L'),
            is_world_series:    (gameType === 'W'),
            is_all_star_game:   (gameType === 'A'),
            is_spring_training: (gameType === 'S'),
            is_exhibition:      (gameType === 'E'),
            is_19th_century:    (gameType === 'N'),
            is_intrasquad:      (gameType === 'I')
          };

      // Additional convenience properties
      type.is_pre_season  = (type.is_spring_training || type.is_exhibition);
      type.is_post_season = (type.is_first_round || type.is_division_series || type.is_league_series || type.is_world_series);

      game.type = type;
    },
    
    /**
     * Augment game object with game status booleans
     */
    extendGameStatus: function (game) {

      var status    = game.status,
          primary   = status.ind.charAt(0),
          secondary = status.ind.charAt(1);

      status.is_scheduled        = (primary === 'S');
      status.is_pre_game         = (primary === 'P' && secondary === '');
      status.is_delayed_start    = (primary === 'P' && secondary !== '' && secondary !== 'W');

      status.is_warmup           = (primary === 'P' && secondary === 'W');
      status.is_in_progress      = (primary === 'I' && secondary === '');
      status.is_instant_replay   = (primary === 'I' && secondary === 'H');
      status.is_delayed          = (primary === 'I' && secondary !== '');
      status.is_suspended        = (primary === 'U' || primary === 'T');

      status.is_over             = (primary === 'O' && secondary === '');
      status.is_final            = (primary === 'F' && (secondary === '' || secondary === 'T'));
      status.is_tied             = (primary === 'F' && secondary === 'T');
      status.is_completed_early  = ((primary === 'O' || primary === 'F') && !status.is_over && !status.is_final);
      status.is_forfeit          = (primary === 'R');

      status.is_postponed        = (primary === 'D');
      status.is_cancelled        = (primary === 'C');

      status.is_before_game      = (status.is_scheduled || status.is_pre_game);
      status.is_during_game      = (status.is_warmup || status.is_in_progress || status.is_instant_replay || status.is_delayed || status.is_delayed_start);
      status.is_after_game       = (status.is_over || status.is_completed_early || status.is_final || status.is_forfeit);
      status.is_nixed            = (status.is_postponed || status.is_cancelled);

      // Handle suspension rules
      if (status.is_suspended) {

        var hasResumeDate = !!game.resume_date,
            currentDateIsResumeDate = (game.current_date === game.resume_date);

        game.has_resumption = (hasResumeDate && !currentDateIsResumeDate);
        game.is_resumption  = (hasResumeDate && currentDateIsResumeDate);
        
        if (game.has_resumption) {
          game.resume_date_formatted = formatDateAsFEY(game.resume_date);
        } else if (game.is_resumption) {
          game.original_date_formatted = formatDateAsFEY(game.original_date);
        }

        if (game.is_resumption) {
          status.is_before_game = true;
        } else {
          status.is_after_game = true;
        }
      }

      status.is_top_of_inning    = (status.top_inning === 'Y');
      status.is_bottom_of_inning = (status.top_inning === 'N');

      status.epg = status.is_before_game ? 'before' :
                   status.is_during_game ? 'during' :
                   status.is_after_game  ? 'after'  :
                   status.is_nixed       ? 'nixed'  : '';

      status.epgSortOrder = this.epgSortOrder[status.epg];
            
      if (status.inning) {
        status.inning_ordinal = $.ordinal(status.inning);
      }

      // @todo remove when no longer necessary
      if (status.is_instant_replay) {
        game.description   = 'Instant Replay';
        status.status = 'Replay';
        status.reason = 'Review';
      }
    },
    
    /**
     * Augment game object with away and home team objects
     */
    extendGameTeams: function (game) {

      var teams = {
            away: {},
            home: {}
          },
          prop,
          matches;

      // Parse away_ and home_ properties and map them to related team object
      for (prop in game) {
        if (game.hasOwnProperty(prop)) {
          matches = prop.match(reHomeAway);
          if (matches !== null && prop !== 'home_runs') {
            teams[matches[1]][matches[2]] = game[prop];
            delete game[prop];
          }
        }
      }

      $.each(teams, function (key, team) {

        // Move sport code to convenient boolean
        team.is_major_league = (team.sport_code === MLB);

        // Set league code to either spring training (if available) or regular
        team.league_code = mlbLeagueCodes[team.league_id_spring || team.league_id];

        // Add team-specific domain to URL
        if (team.sport_code === MLB && team.team_id in clubProps) {
          team.url_cache = 'http://' + clubProps[team.team_id].url_cache;
          team.url = team.url_cache + '/index.jsp?c_id=' + team.file_code;
        }
        
        // add links
        team.links = {
          stats:    this.currentHost + 'stats/sortable_player_stats.jsp?c_id=' + team.file_code,
          news:     this.currentHost + 'news/index.jsp?c_id=' + team.file_code,
          fantasy:  this.currentHost + 'mlb/fantasy/wsfb/news/index.jsp?team_id=' + team.team_id,
          schedule: this.currentHost + 'schedule/index.jsp?c_id=' + team.file_code,
          more:     this.currentHost + 'index.jsp?c_id=' + team.file_code
        };
                
      });
      
      if (game.status.is_top_of_inning) {
        teams.pitching = teams.home;
        teams.batting  = teams.away;
      } else {
        teams.pitching = teams.away;
        teams.batting  = teams.home;
      }

      game.teams = teams;
    },
    
    reGotD: /\b(ALL|WEB_MEDIAPLAYER)\b/,
    
    /**
     * Extract media (for thumbnails)
     */
    extendGameMedia: function (game) {

      var gameMedia = $.deep(game, 'game_media.media'),
          media = $.ensureArray(gameMedia),
          i = 0, n = media.length;

      // @todo why did i need to do this?
      for (; i < n; ++i) {
        $.deep(game, 'game_media.' + media[i].type, media[i]);
      }

      // FREE Game of the Day!
      game.is_free_gotd = gameMedia && this.reGotD.test(gameMedia.free);
    },
    
    /**
     * Sort home runs by inning (until more specific data is included)
     */
    sortHomeRuns: function (a, b) {
      return +a.inning > +b.inning;
    },
    
    /**
     * Parse home run data and augment game team objects with home run arrays
     */
    extendHomeRuns: function (game) {

      var away     = game.teams.away,
          home     = game.teams.home,
          homeRuns = {},
          players  = $.ensureArray($.deep(game, 'home_runs.player')),
          i, n, player;
          
      // Map home runs arrays by team code
      homeRuns[away.code] = away.home_runs = [];
      homeRuns[home.code] = home.home_runs = [];

      for (i = 0, n = players.length; i < n; ++i) {
        player = players[i];
        if (typeof homeRuns[player.team_code] !== 'undefined') {
          homeRuns[player.team_code].push(player);
        }
      }

      away.home_runs.sort(this.sortHomeRuns);
      home.home_runs.sort(this.sortHomeRuns);
    },
    
    /**
     * Ensure game object contains a linescore object
     */
    extendLinescore: function (game) {
      game.linescore = game.linescore || { r: {}, h: {}, e: {} };
      game.linescore.inning = $.ensureArray(game.linescore.inning);
    },
    
    /**
     * Augment game object with doubleheader status
     */
    extendDoubleheader: function (game) {

      // Doubleheader
      game.game_number = game.id.substr(-1);
      game.is_doubleheader = (game.game_number === '2');
    },
    
    /**
     * Ensure game object contains a links object
     */
    extendLinks: function (game) {
      
      var links   = game.links || {},
          status  = game.status,
          gameday = game.gameday,
          teams   = game.teams;

      links.buyMLBTV = game.type.is_post_season
        ? this.currentHost + 'mediacenter/index.jsp?affiliateId=mlbSCOREBOARD&tcid=mlb_scoreboard'
        : this.currentHost + 'mlb/subscriptions/index.jsp?product=mlbtv';      
      links.mlbtv         = links.mlbtv && makeJavaScriptUrl(links.mlbtv);
      links.postseason_tv = links.postseason_tv && makeJavaScriptUrl(links.postseason_tv);
      links.away_audio    = links.away_audio && makeJavaScriptUrl(links.away_audio);
      links.home_audio    = links.home_audio && makeJavaScriptUrl(links.home_audio);
      links.audio         = links.home_audio || links.away_audio;
      links.press         = this.currentHost + 'mlb/presspass/gamenotes.jsp?c_id=mlb';
      links.probables     = this.currentHost + 'news/probable_pitchers/index.jsp?c_id=mlb&date=' + game.original_date + '#' + teams.away.name_abbrev + '@' + teams.home.name_abbrev;

      if (gameday) {
        links.preview   = makeJavaScriptUrl('launchGameday({gid:"' + gameday + '",mode:"preview"})');
        links.probables = links.preview;
        links.gameday   = makeJavaScriptUrl('launchGameday({gid:"' + gameday + '",mode:"gameday"})');
        links.classic   = makeJavaScriptUrl('launchGameday({gid:"' + gameday + '",mode:"classic"})');
        links.atbat     = makeJavaScriptUrl('launchGameday({gid:"' + gameday + '",mode:"atbat"})');
        links.wrapup    = links.wrapup && makeJavaScriptUrl('launchGameday({gid:"' + gameday + '",mode:"wrap"})');

        if (status.is_pre_game || status.is_during_game) {
          links.boxscore = '/news/boxscore.jsp?gid=' + game.gameday;
        } else if (status.is_after_game) {
          links.boxscore   = makeJavaScriptUrl('launchGameday({gid:"' + gameday + '",mode:"box"})');
          links.highlights = makeJavaScriptUrl('launchGameday({gid:"' + gameday + '",mode:"video"})');
        }
        
        if (status.is_pre_game || status.is_during_game || status.is_after_game) {
          links.boxscore_es = this.currentHost + '/news/boxscore_es.jsp?gid=' + game.gameday;
        }
      }

      game.links = links;
    },
    
    /**
     * Track score updates between data refreshes
     */
    extendGameScoreUpdated: function (game) {
      if (game.status.is_during_game) {
        var hash = this.scoreUpdatedHash[game.gameday];
        var score = $.deep(game, 'linescore.r.away') + '-' + $.deep(game, 'linescore.r.home');
        game.score_changed = hash && hash !== score;
        this.scoreUpdatedHash[game.gameday] = score;
      }
    },
    
    /**
     * Track runners on base between data refreshes
     */
    extendGameRunners: function (game) {

      game.runners_on_base = game.runners_on_base || {};

      if (game.status.is_during_game) {

        var hash      = this.runnersHash[game.gameday],
            inningKey = game.status.inning + game.status.top_inning,
            current   = game.runners_on_base,
            previous,
            i,
            prop;

        if (hash && hash.inningKey === inningKey) {

          previous = hash.runnersOnBase;

          for (i = 1; i <= 3; ++i) {
            prop = 'runner_on_' + i + 'b';

            // @todo - remove this after updating expanded scoreboard
            // with new menOnBase
            if (current[prop]) {
              current[prop].previous = previous[prop];

              if ((!previous[prop] || current[prop].id !== previous[prop].id)) {
                current[prop].moved = true;
              }
            }
          }
        }

        this.runnersHash[game.gameday] = {
          inningKey:     inningKey,
          runnersOnBase: current
        };

      }
    },
    
    /**
     * Augment game object with league/type for grouping on scoreboard
     */
    extendLeagueTypeArea: function (game) {

      var homeLeagueCode = game.teams.home.league_code,
          awayLeagueCode = game.teams.away.league_code,
          gameLeagueCode = homeLeagueCode || awayLeagueCode;

      // Game is considered major league if either team is major league
      game.is_major_league = (game.teams.away.is_major_league || game.teams.home.is_major_league);

      // Exhibition
      if (game.type.is_exhibition) {
        game.leagueAreaKey = 'E';

      // World Series
      } else if (game.type.is_world_series) {
        game.leagueAreaKey = 'WS_' + gameLeagueCode;

      // All-Star Game
      } else if (game.type.is_all_star_game) {
        game.leagueAreaKey = 'AS_' + gameLeagueCode;

      // Undefined
      } else if (typeof gameLeagueCode === 'undefined') {
        game.leagueAreaKey = null;

      // World Baseball Classic
      } else if (gameLeagueCode === WBC) {
        // ignore WBC games
        // game.leagueAreaKey = gameLeagueCode;

      // Spring Training
      } else if (gameLeagueCode === GL || gameLeagueCode === CL) {
        game.leagueAreaKey = gameLeagueCode;

      // Intraleague
      } else if (homeLeagueCode === awayLeagueCode) {
        game.leagueAreaKey = gameLeagueCode;

      // Interleague
      } else {
        game.leagueAreaKey = 'X_' + gameLeagueCode;
      }
    },

    /**
     * 
     */
    addTeamToPlayer: function (player, team) {
      player.team = team;
      if (player.id && team.is_major_league) {
        player.link = this.currentHost + 'team/player.jsp?player_id=' + player.id;
      }
    },

    /**
     * 
     */
    extendPlayers: function (game) {

      var away  = game.teams.away,
          home  = game.teams.home,
          teams = {},
          homeRunPlayers = $.ensureArray($.deep(game, 'home_runs.player')),
          i, n, player, code, team;

      // extend home run hitters
      teams[away.code] = away;
      teams[home.code] = home;

      for (i = 0, n = homeRunPlayers.length; i < n; ++i) {
        player = homeRunPlayers[i];
        if (player.team_code && player.team_code in teams) {
          this.addTeamToPlayer(player, teams[player.team_code]);
        }
      }
      
      // extend probable pitchers
      for (code in teams) {
        team = teams[code];
        // if (team.probable_pitcher && team.probable_pitcher.last) {
        //   this.addTeamToPlayer(team.probable_pitcher, team);
        // }
        if (team.probable_pitcher) {
          team.probable_pitcher.last = team.probable_pitcher.last || team.probable_pitcher.last_name;
          if (team.probable_pitcher.last) {
            this.addTeamToPlayer(team.probable_pitcher, team);
          }
        }
      }
      
      // extend pitcher/batters
      if (game.pitcher && game.teams.pitching) {
        this.addTeamToPlayer(game.pitcher, game.teams.pitching);
      }
      
      if (game.batter && game.teams.batting) {
        this.addTeamToPlayer(game.batter, game.teams.batting);
      }

      // extend win/lose/save pitchers
      if (game.winning_pitcher && game.teams.winning) {
        this.addTeamToPlayer(game.winning_pitcher, game.teams.winning);
      }

      if (game.losing_pitcher && game.teams.losing) {
        this.addTeamToPlayer(game.losing_pitcher, game.teams.losing);
      }

      if (game.save_pitcher && game.teams.winning) {
        this.addTeamToPlayer(game.save_pitcher, game.teams.winning);
      }
      
      // @todo add player link
    },
    
    /**
     * If game is complete, augment game object with winning and losing team
     * objects
     */
    extendWinningTeams: function (game) {

      var teams    = game.teams,
          away     = teams.away,
          home     = teams.home,
          runs     = game.linescore.r,
          runsAway = +runs.away,
          runsHome = +runs.home;

      if (runsAway > runsHome) {
        teams.winning = away;
        teams.losing  = home;
      } else if (runsHome > runsAway) {
        teams.winning = home;
        teams.losing  = away;
      }
    },
    
    /**
     * This slightly unorthodox manner of sorting is necessary to workaround 
     * a Google Chrome bug where objects sorted by property with matching
     * values lose their initial sort order.
     * @see bug report http://code.google.com/p/v8/issues/detail?id=90
     * @see my detection code for this bug: http://gist.github.com/340616
     */
    sortByGameStatus: function (games) {
      
      if (games.length === 0) {
        return [];
      }

      var i, n, game,
          g = {
            during: [],
            before: [],
            after:  [],
            nixed:  []
          };

      for (i = 0, n = games.length; i < n; ++i) {
        game = games[i];
        if (game.status.epg) {
          g[game.status.epg].push(game);
        }
      }
      return [].concat(g.during, g.before, g.after, g.nixed);
    },

    /**
     * 
     */
    extendPlayByPlay: function (game) {

      var pbp = game.pbp;
      if (game.pbp && pbp.last) {
        pbp.last = pbp.last.replace(/\s+/g, ' ');
        pbp.last_truncated = $.truncate(pbp.last, 120);
      }
    },
    
    
    extendPostseason: function (game) {

      var type   = game.type,
          num    = +game.series_num,
          teams  = game.teams,
          away   = teams.away,
          home   = teams.home,
          series = game.series = {
            series: game.series,
            num:    num
          };

      // Determine series home/away teams
      if (type.is_division_series) {
        if (num === 1 || num === 2 || num === 5) {
          series.home = home;
          series.away = away;
        } else {
          series.home = away;
          series.away = home;
        }
      } else if (type.is_league_series || type.is_world_series) {
        if (num === 1 || num === 2 || num === 6 || num === 7) {
          series.home = home;
          series.away = away;
        } else {
          series.home = away;
          series.away = home;
        }
      }
      
      // Determine series leader
      if (away.win > home.win) {
        series.leading  = away;
        series.trailing = home;
      } else if (home.win > away.win) {
        series.leading  = home;
        series.trailing = away;
      } 
    },

    /**
     * 
     */
    extendGame: function (game, date) {

      this.extendGameTime(game, date);
      this.extendGameType(game);
      this.extendGameStatus(game);        
      this.extendGameTeams(game);
      this.extendGameMedia(game);
      this.extendHomeRuns(game);
      this.extendLinescore(game);
      this.extendDoubleheader(game);
      this.extendLinks(game);
      this.extendGameScoreUpdated(game);
      this.extendGameRunners(game);
      this.extendLeagueTypeArea(game);
      this.extendPlayByPlay(game);
      this.extendPostseason(game);
      if (game.status.is_after_game) {
        this.extendWinningTeams(game);
      }
      this.extendPlayers(game);

      return game;
    },
    
    sortByLeagueArea: function (games) {
      var gamesByLeagueArea = {}, i, n, game;

      for (i = 0, n = games.length; i < n; ++i) {
        game = games[i];
        if (game.leagueAreaKey) {
          (gamesByLeagueArea[game.leagueAreaKey] = gamesByLeagueArea[game.leagueAreaKey] || []).push(game);
        }
      }
      
      return gamesByLeagueArea;
    }
  };
  

  // Add $.loadable behavior to MasterScoreboard
  $.loadable(MasterScoreboard, {
    dataType: 'text',
    cache:    !bam.env.host.isDev, // bust cache on dev
    dataFilter: function (response, type) {

      var data = $.parseJSON(response);

      data = $.deep(data, 'data.games');
      
      var self  = this,
          date  = [data.year, data.month, data.day].join('/'),
          games = $.map($.ensureArray(data.game), function (game, i) {
            return self.extendGame(game, date);
          });

      return {
        date:  date,
        games: this.sortByGameStatus(games)
      };
    }
  });


  // Overload $.loadable load method with a custom load method that accepts
  // a date as an optional parameter to configure the request URL
  MasterScoreboard.prototype.loadableConfig = (function (loadableConfig) {
    return function (date) {

      // If undefined, set date current date/time Eastern and display
      // previous day's scoreboard until 11am ET (or specified time)
      if (typeof date === 'undefined') {
        date = bam.getFlipDisplayDate();
      } else {        
        date = $.ensureDate(date);
      }
	
      var url =  (env.currentEnv==="PROD") 
 					? main.config.scoreboardUrls.data.PROD 
					: main.config.scoreboardUrls.data.QA;

      return loadableConfig.call(
			this, 
			enyo.macroize(
				url,
				{
					"YYYY" : date.getFullYear(),
					"MM" : addLeadingZeros(date.getMonth() + 1),
					"DD" : addLeadingZeros(date.getDate())
				}
			)
		);
      
    };
  })(MasterScoreboard.prototype.loadableConfig);


  // Add MasterScoreboard to bam.services namespace
  bam.namespace('services').MasterScoreboard = MasterScoreboard;


})(this, this.document, this.jQuery, this.bam);