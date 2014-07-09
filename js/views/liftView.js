define(['jquery','underscore','backbone','d3','c3','bootstrap','dateformat','models/lift-data','models/medialist','text!templates/lift-report.html'],
	function($,_,Backbone,d3,c3,bootstrap,dateformat,Lift,MediaList,liftTemplate){
		//todo: twitter
		var liftView = Backbone.View.extend({
			tagName: "div",
			medialist: [],
			events: {
				"click .export-data": "exportData"
			},
			exportable: false,
			initialize: function(options){
				this.options = options || {};				
				this.requestDate = (new Date(parseInt(this.model.get("timestamp"))*1000)).format("yyyy-mm-dd");
				this.render();
				this.fetchMediaList("");
				this.delegateEvents();				
			},
			
			render: function(){
				var compiledtemplate = _.template(liftTemplate,{model:this.model,_:_,requestDate:this.requestDate});
				this.setElement(compiledtemplate);
				return this;
			},

			fetchMediaList: function(max_id){
				var that = this;
				var timeperiod = parseInt(this.model.get("track_period"))*24*60*60*1000;
				var mintime = parseInt(this.model.get("timestamp"))*1000 - timeperiod;
				var maxtime = parseInt(this.model.get("timestamp"))*1000 + timeperiod;
				var m = new MediaList({},{user_id:this.model.get("user_id"),min_timestamp:(mintime/1000).toString(),max_timestamp:(maxtime/1000).toString(),max_id:max_id});
				m.fetch({
					dataType: 'jsonp', 
					success: function(media){
						that.medialist = that.medialist.concat(media.models);
						if (m.max_id) {
							that.fetchMediaList(m.max_id)
						} else {
							that.analyze(that.medialist);
						}

					}
				});
			},
			
			analyze: function(mlist){
				this.setupLifts(mlist);
				var graphlift = this.handleLift(this.lifts); 
				this.graphLift(graphlift);
			},

			handleLift: function(lifts){
				var data = {};
				var that = this;
				that.tagcount = {};
				_.each(lifts,function(l){
					var count = {};
					that.tagcount[l.get("tag_name")]={};
					var total_count = 0;
					var before_count = 0;
					var after_count = 0;
					_.each(l.get("normalized_time"),function(t){
						var dt = new Date(parseInt(t)*1000);
						dt = dt.format("yyyy-mm-dd");
						if (!count[dt]) {
							count[dt]=1;
						} else {
							count[dt]++;
						}
					});

					_.each(l.get("raw_time"),function(t){
						total_count++;
						if (t <= that.model.get("timestamp")) {
							before_count++;
						} else {
							after_count++;
						}
					});

					that.tagcount[l.get("tag_name")]["total_count"] = total_count;
					that.tagcount[l.get("tag_name")]["before_count"] = before_count;
					that.tagcount[l.get("tag_name")]["after_count"] = after_count;
					data[l.get("tag_name")] = count;
				});
				that.$('#tag-list-event-'+that.model.get("username")+"-"+that.model.get("provider")).html("");
				_.each(that.tagcount,function(count,tag){
					var beforeDiv = "<p><b>Before count:</b> " + count["before_count"]+"</p>";
					var afterDiv = "<p><b>After count:</b> " + count["after_count"]+"</p>";
					var id = tag + "-event-" + that.model.get("username")+"-"+that.model.get("provider");
					var tagDiv = "<a rel='popover' data-toggle='popover' data-placement='bottom' \
					data-content='" + beforeDiv + afterDiv + "' id='" + id + "'>#" 
					+ tag + "(" + count["total_count"] + ")</a> ";
					that.$('#tag-list-event-'+that.model.get("username")+"-"+that.model.get("provider")).append(tagDiv);
					that.$("#"+id).popover({html:true});
				});
				return data;
			},

			graphLift: function(data){
				//data: {"tag_name": {"timestamp1":count_1,"timestamp2":count_2}}
				var taglist = Object.keys(data);
				var counts = {};
				_.each(data,function(v,k){
					counts[k]=[["timestamp-"+k],[k]];
					_.each(v,function(c,t){
						counts[k][1].push(c);
						counts[k][0].push(t);
					});
				});
				//counts["tag_name"] = [["timestamp",t1,t2],["tag_name",count1,count2]]
				var summaryData = {};
				summaryData["username"] = this.model.get("username");
				summaryData["data"] = data;
				summaryData["tagcount"] = this.tagcount;
				//need fix: queue up in the report instead of reloading once hit report
				if (this.options.event_bus!=undefined){ 
					this.options.event_bus.trigger('doneIndividualReport',summaryData);
				}


				//initiate inputs for c3 chart
    		var xs = {};
    		var columns = [];
    		var counter = 1;
    		_.each(counts, function(v,k){
    			xs[k]=v[0][0];
    			columns.push(v[0]); //setup timestamp
    			var newYaxis = [];
    			_.each(v[1], function(c){
    				if (c == k) {newYaxis.push(c)} else {newYaxis.push(counter);}
    			}); 
    			columns.push(newYaxis); //setup y_axis
    			counter++;
    		});

				var chartContainer = '#lift-chart-'+this.model.get("username")+"-"+this.model.get("provider");
				var chart = c3.generate({
				    bindto: chartContainer,
				    size: {
				        height: 267,
				        width: 717
				    },				    
				    data: {
				    	xs: xs,
				    	columns: columns,
				    	type: 'scatter'
				    },
				    axis: {
				        x: {
				          type: 'timeseries',
			            format: '%Y-%m-%d'
				        },
				        y: {
				        	min: 0,
				        	max: counter,
				        	padding: {top:0, bottom:0},
				        	tick: {
				        		count: counter,
				        		format: function(d) {
				        			if (d*10%10 != 0) {
				        				return "";
				        			} else {
				        				return taglist[d-1];
				        			}
				        		}
				        	} 
				        }
				    },
				    tooltip: {
				    	format: {
					    	title: function(d) {
					    		return "Number of tags";
					    	},				    		
					    	value: function(value, ratio, id, pos){
					    		return counts[id][1][pos+1];
					    	}				    		
				    	}
				    },
				    grid: {
				        x: {
				            lines: [{value: this.requestDate, text: 'Right request'}]
				        }
				    }				    				    
				});
			},

			setupLifts: function(mlist){
				var that = this;
				var lifts = new Lift.collection();
				_.each(mlist,function(media){
					var tags = media.get("tags");
					var timestamp = that.parseDate(media.get("created_time")); //normalize timestamp - ignoring time, set to 00:00:00
					_.each(tags, function(tag){
						if (_.contains(that.model.get("tags"),tag)) {
							if (lifts.where({"tag_name":tag.toLowerCase()}).length==0) {
								var newlift = new Lift.model({
									"tag_name": tag.toLowerCase(),
									"raw_time":[media.get("created_time")],
									"normalized_time":[timestamp],
									"link":[media.get("link")],
									"id":[media.get("id")]
								});
								lifts.add([newlift]);
							} else {
								var l = lifts.findWhere({"tag_name": tag.toLowerCase()});
								l.set("raw_time",l.get("raw_time").concat([media.get("created_time")]));
								l.set("normalized_time",l.get("normalized_time").concat([timestamp]));
								l.set("link",l.get("link").concat([media.get("link")]));
								l.set("id",l.get("id").concat([media.get("id")]));
							}
						}
					});
				});
				that.exportable = true;
				that.lifts = lifts.models;
			},

			parseDate: function(timestamp){
				var d = new Date(parseInt(timestamp)*1000);
				var newD = Date.parse(new Date(d.getFullYear(),d.getMonth(),d.getDate()));
				return (Date.parse(new Date(d.getFullYear(),d.getMonth(),d.getDate()))/1000).toString();
			},

			exportData: function(){
				if (this.exportable){
					var csvrows = [['tag name','media id','link','created time','normalized time']];
					_.each(this.lifts,function(l){
						for (i=0; i<l.get("id").length;i++) {
							csvrows.push([l.get("tag_name"),l.get("id")[i],l.get("link")[i],l.get("raw_time")[i],l.get("normalized_time")[i]]);			
						}
					})
					var csvstring = csvrows.join("\n");
					//need fix file extension .csv
					var uri = 'data:application/csv;charset=UTF-8,' + encodeURIComponent(csvstring);
					window.open(uri);
				}
			},
			hide: function(){
				this.$el.hide();
			},
			show: function(){
				this.$el.show();
			}	
		});
		return liftView;
});