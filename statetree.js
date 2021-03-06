var makeStateTree = (function (_) {
    var DEBUG = true;
    var State = function (name, parentState) {
        this.name = name;
        this.childStates = [];
        this.subStatesAreConcurrent = false;
        if(parentState) {
            this.parentState = parentState;
            parentState.childStates.push(this);
            this.statechart = parentState.statechart;
            this.statechart.statesByName[name] = this;
        }
    };
    State.prototype.subState = function (name) {
        return new State(name, this);
    };
    State.prototype.defaultState = function () {
        if(!this.parentState) {
            throw new Error("cannot default root state");
        }
        this.parentState.defaultTo(this);
        return this;
    };
    State.prototype.changeDefaultTo = function (state) {
        this.defaultSubState = state;
        return this;
    };
    State.prototype.defaultTo = function (state) {
        if(this.defaultSubState) {
            errorDefaultAndConcurrent(state);
        }
        return this.changeDefaultTo(state);
    };
    var errorDefaultAndConcurrent = function (state) {
        throw new Error("cannot have a default sub state among concurrent states");
    };
    State.prototype.concurrentSubStates = function () {
        if(this.defaultSubState) {
            errorDefaultAndConcurrent(this.defaultSubState);
        }
        this.subStatesAreConcurrent = true;
        return this;
    };
    var assertEmptyFn = function (fn, name) {
        if(fn) {
            throw new Error(name + " function already defined");
        }
    };
    State.prototype.enter = function (fn) {
        assertEmptyFn(this.enterFn, "enter");
        this.enterFn = fn;
        return this;
    };
    State.prototype.exit = function (fn) {
        assertEmptyFn(this.exitFn, "exit");
        this.exitFn = fn;
        return this;
    };
    State.prototype.activeSubState = function () {
        var _this = this;
        return _.find(this.childStates, function (state) {
            return _this.statechart.isActive[state.name];
        });
    };
    var safeCallback = function (statechart, cb) {
        var args = [];
        for (var _i = 0; _i < (arguments.length - 2); _i++) {
            args[_i] = arguments[_i + 2];
        }
        if(!cb) {
            return undefined;
        }
        try  {
            cb.apply(undefined, args);
        } catch (e) {
            statechart.handleError(e, cb, args);
        }
    };
    var exitStates = function (exited) {
        _.each(exited.reverse(), function (state) {
            state.statechart.isActive[state.name] = false;
            if(state.parentState) {
                state.parentState.history = state;
            }
            if(DEBUG) {
                console.log("exiting: " + state.name + " history of " + state.parentState.name);
            }
            safeCallback(state.statechart, state.exitFn, state);
        });
    };
    var iterateActive = function (tree, cb) {
        _.each(tree.childStates, function (node) {
            if(tree.statechart.isActive[node.name]) {
                cb(node);
                iterateActive(node, cb);
            }
        });
    };
    var moveUpToActive = function (state, entered) {
        if(state.statechart.isActive[state.name]) {
            return state;
        } else {
            entered.push(state);
            return moveUpToActive(state.parentState, entered);
        }
    };
    var inGoTo = [];
    var handlePendingGoTo = function (currentState) {
        var nextState = inGoTo.shift();
        if(inGoTo.length > 0) {
            throw new Error("requested to goTo multiple other states " + _(inGoTo).pluck('name') + " while using a goTo to enter state " + currentState.name);
        }
        if(nextState) {
            nextState.goTo();
        }
        return currentState;
    };
    State.prototype.goTo = function () {
        if(inGoTo.length > 0) {
            inGoTo.push(this);
            return;
        }
        var statechart = this.statechart;
        var entered = [];
        var exited = [];
        var alreadyActive = moveUpToActive(this, entered);
        entered.reverse();
        if(alreadyActive.name === this.name) {
            return handlePendingGoTo(this);
        }
        if(!alreadyActive.subStatesAreConcurrent) {
            _.each(alreadyActive.childStates, function (state) {
                if(state.name != entered[0].name) {
                    if(statechart.isActive[state.name]) {
                        exited.push(state);
                        iterateActive(state, function (s) {
                            return exited.push(s);
                        });
                    }
                }
            });
        }
        var expected = this;
        if(entered.length > 0) {
            var last = null;
            var def = null;
            while(def = ((last = entered[entered.length - 1]) && ((statechart.defaultToHistory && last.history) || last.defaultSubState))) {
                entered.push(def);
                expected = def;
            }
        } else {
            throw new Error("impossible!");
        }
        exitStates(exited);
        if(DEBUG) {
            _.each(entered, function (state) {
                return console.log("entering " + state.name);
            });
        }
        _.each(entered, function (state) {
            statechart.isActive[state.name] = true;
            safeCallback(statechart, state.enterFn, state);
        });
        if(DEBUG) {
            if(statechart.currentStates().indexOf(expected) == -1) {
                throw new Error("expected to go to state " + this.name + ", but now in states " + _(statechart.currentStates()).pluck('name').join(","));
            }
        }
        return handlePendingGoTo(this);
    };
    var StateChart = function (root) {
        var statesByName = {
        };
        statesByName[root.name] = root;
        var isActive = {
        };
        isActive[root.name] = true;
        var chart = {
            root: root,
            statesByName: statesByName,
            isActive: isActive,
            handleError: function (e) {
                if(e.message) {
                    console.log(e.message);
                }
                if(e.stack) {
                    console.log(e.stack);
                }
            },
            defaultToHistory: false,
            defaultToHistoryState: function () {
                this.defaultToHistory = true;
            },
            activeStates: function () {
                var actives = [
                    this.root
                ];
                iterateActive(this.root, function (state) {
                    return actives.push(state);
                });
                return actives;
            },
            currentStates: function () {
                var leaves = [];
                var statechart = this;
                iterateActive(statechart.root, function (state) {
                    if(!_.any(state.childStates, function (child) {
                        return statechart.isActive[child];
                    })) {
                        leaves.push(state);
                    }
                });
                return (leaves.length == 0) ? [
                    this.root
                ] : leaves;
            }
        };
        root.statechart = chart;
        return chart;
    };
    return function () {
        return StateChart(new State("root"));
    }
})(lodash);
