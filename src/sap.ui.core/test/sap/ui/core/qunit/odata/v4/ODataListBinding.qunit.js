/*!
 * ${copyright}
 */
sap.ui.require([
	"sap/ui/base/ManagedObject",
	"sap/ui/model/ChangeReason",
	"sap/ui/model/Context",
	"sap/ui/model/ListBinding",
	"sap/ui/model/Model",
	"sap/ui/model/odata/v4/_ODataHelper",
	"sap/ui/model/odata/v4/lib/_Cache",
	"sap/ui/model/odata/v4/ODataListBinding",
	"sap/ui/model/odata/v4/ODataModel"
], function (ManagedObject, ChangeReason, Context, ListBinding, Model, _ODataHelper, _Cache,
		ODataListBinding, ODataModel) {
	/*global QUnit, sinon */
	/*eslint max-nested-callbacks: 0, no-warning-comments: 0 */
	"use strict";

	var TestControl = ManagedObject.extend("test.sap.ui.model.odata.v4.ODataListBinding", {
		metadata : {
			aggregations : {
				items : {multiple : true, type : "test.sap.ui.model.odata.v4.ODataListBinding"}
			}
		}
	});

	/**
	 * Creates a promise as mock for _Cache.read which is fulfilled asynchronously with a result of
	 * the given length.
	 * iStart determines the start index for the records contained in the result.
	 *
	 * @param {number} iLength
	 *   array length
	 * @param {number} [iStart=0]
	 *   start index
	 * @param {boolean} [bDrillDown]
	 *   simulate drill-down, i.e. resolve with unwrapped array
	 * @return {Promise}
	 *   the promise which is fulfilled as specified
	 */
	function createResult(iLength, iStart, bDrillDown) {
		return new Promise(function (resolve, reject) {
			var oData = {value : []},
				i;

			iStart = iStart || 0;
			for (i = 0; i < iLength; i += 1) {
				oData.value[i] = {
					Name : "Name " + (iStart + i),
					LOCATION : {
						COUNTRY : "COUNTRY " + (iStart + i)
					},
					NullValue : null
				};
			}
			resolve(bDrillDown ? oData.value : oData);
		});
	}

	//*********************************************************************************************
	QUnit.module("sap.ui.model.odata.v4.ODataListBinding", {
		beforeEach : function () {
			this.oSandbox = sinon.sandbox.create();

			this.oLogMock = this.oSandbox.mock(jQuery.sap.log);
			this.oLogMock.expects("error").never();
			this.oLogMock.expects("warning").never();

			// create ODataModel
			this.oModel = new ODataModel("/service/?sap-client=111");
			this.oModel.setSizeLimit(3);
		},
		afterEach : function () {
			// I would consider this an API, see https://github.com/cjohansen/Sinon.JS/issues/614
			this.oSandbox.verifyAndRestore();
		},

		/**
		 * Creates a sinon mock for a cache object with read and refresh methods.
		 * @returns {object}
		 *   a Sinon mock for the created cache object
		 */
		getCacheMock : function () {
			var oCache = {
					read : function () {},
					refresh : function () {},
					toString : function () { return "/service/EMPLOYEES"; }
				};

			this.oSandbox.mock(_Cache).expects("create").returns(oCache);
			return this.oSandbox.mock(oCache);
		}
	});

	//*********************************************************************************************
	QUnit.test("bindList with parameters", function (assert) {
		var oBinding,
			oContext = {},
			oError = new Error("Unsupported ..."),
			oHelperMock,
			mParameters = {"$expand" : "foo", "$select" : "bar", "custom" : "baz"},
			mQueryOptions = {};

		oHelperMock = this.mock(_ODataHelper);
		oHelperMock.expects("buildQueryOptions")
			.withExactArgs(this.oModel.mUriParameters, mParameters, ["$expand", "$select"])
			.returns(mQueryOptions);
		this.mock(_Cache).expects("create")
			.withExactArgs(sinon.match.same(this.oModel.oRequestor), "EMPLOYEES",
				sinon.match.same(mQueryOptions));

		oBinding = this.oModel.bindList("/EMPLOYEES", oContext, undefined, undefined, mParameters);

		assert.ok(oBinding instanceof ODataListBinding);
		assert.strictEqual(oBinding.getModel(), this.oModel);
		assert.strictEqual(oBinding.getContext(), oContext);
		assert.strictEqual(oBinding.getPath(), "/EMPLOYEES");
		assert.deepEqual(oBinding.aContexts, []);
		assert.strictEqual(oBinding.iMaxLength, Infinity);
		assert.strictEqual(oBinding.isLengthFinal(), false);
		assert.strictEqual(oBinding.mParameters, undefined);

		//no call to buildQueryOptions for binding with relative path and no parameters
		oBinding = this.oModel.bindList("EMPLOYEE_2_TEAM");
		assert.strictEqual(oBinding.hasOwnProperty("oCache"), true, "oCache property is set");
		assert.strictEqual(oBinding.oCache, undefined, "oCache property is undefined");

		//error for invalid parameters
		oHelperMock.expects("buildQueryOptions").throws(oError);

		assert.throws(function () {
			this.oModel.bindList("/EMPLOYEES", null, undefined, undefined, mParameters);
		}, oError);

		//error for relative paths
		assert.throws(function () {
			this.oModel.bindList("EMPLOYEE_2_EQUIPMENTS", null, undefined, undefined, mParameters);
		}, new Error("Bindings with a relative path do not support parameters"));

		//TODO parameter aSorters and aFilters
	});

	//*********************************************************************************************
	["", "/", "foo/"].forEach(function (sPath) {
		QUnit.test("bindList: invalid path: " + sPath, function (assert) {
			assert.throws(function () {
				this.oModel.bindList(sPath);
			}, new Error("Invalid path: " + sPath));
		});
	});

	//*********************************************************************************************
	// fixture with range for aggregation binding info (default {}) and
	//              number of entities (default is length requested to read)
	[
		{range : {}},
		{range : {startIndex : 1, length : 3}},
		{range : {startIndex : 1, length : 3}, entityCount : 2}
	].forEach(function (oFixture) {
		QUnit.test("getContexts satisfies contract of ManagedObject#bindAggregation "
			+ JSON.stringify(oFixture),
		function (assert) {
			var oCacheMock = this.getCacheMock(),
				oControl = new TestControl({models : this.oModel}),
				oRange = oFixture.range || {},
				iLength = oRange.length || this.oModel.iSizeLimit,
				iEntityCount = oFixture.entityCount || iLength,
				iStartIndex = oRange.startIndex || 0,
				oPromise = createResult(iEntityCount);

			// check that given spy is called with exact arguments
			function checkCall(oSpy) {
				assert.ok(
					oSpy.calledWithExactly.apply(oSpy, Array.prototype.slice.call(arguments, 1)),
					oSpy.printf("%n call %C"));
			}

			// change event handler for initial read for list binding
			function onChange() {
				var aChildControls = oControl.getItems(),
					sExpectedPath,
					i;

				assert.strictEqual(aChildControls.length, iEntityCount, "# child controls");
				for (i = 0; i < iEntityCount; i += 1) {
					sExpectedPath = "/EMPLOYEES/" + (i + iStartIndex);
					assert.strictEqual(aChildControls[i].getBindingContext().getPath(),
						sExpectedPath, "child control binding path: " + sExpectedPath);
				}
			}

			if (iEntityCount < iLength) {
				oCacheMock.expects("read")
					.withArgs(iStartIndex, iLength, "")
					// read is called twice because contexts are created asynchronously
					.twice()
					.returns(oPromise);
			} else {
				oCacheMock.expects("read")
					.withArgs(iStartIndex, iLength, "")
					.returns(oPromise);
			}
			// spies to check and document calls to model and binding methods from ManagedObject
			this.spy(this.oModel, "bindList");
			this.spy(ODataListBinding.prototype, "initialize");
			this.spy(ODataListBinding.prototype, "getContexts");

			// code under test
			oControl.bindAggregation("items", jQuery.extend({
				path : "/EMPLOYEES",
				template : new TestControl()
			}, oRange));

			// check v4 ODataModel APIs are called as expected from ManagedObject
			checkCall(this.oModel.bindList, "/EMPLOYEES", undefined, undefined, undefined,
				undefined);
			checkCall(ODataListBinding.prototype.initialize);
			checkCall(ODataListBinding.prototype.getContexts, oRange.startIndex, oRange.length);

			oControl.getBinding("items").attachChange(onChange);
			assert.deepEqual(oControl.getItems(), [], "initial synchronous result");

			return oPromise;
		});
	});

	//*********************************************************************************************
	QUnit.test("nested listbinding", function (assert) {
		var oBinding,
			oControl = new TestControl({models : this.oModel}),
			sPath = "TEAM_2_EMPLOYEES",
			oRange = {startIndex : 1, length : 3},
			oPromise = createResult(oRange.length, 0, true),
			that = this;

		// change event handler for initial read for list binding
		function onChange() {
			var aChildControls = oControl.getItems(),
				aOriginalContexts = oBinding.aContexts,
				i;

			assert.strictEqual(aChildControls.length, 3, "# child controls");
			for (i = 0; i < 3; i += 1) {
				assert.strictEqual(aChildControls[i].getBindingContext().getPath(),
					"/TEAMS('4711')/" + sPath + "/" + (i + oRange.startIndex));
			}

			// code under test
			oBinding.setContext(oBinding.getContext());
			assert.strictEqual(oBinding.aContexts, aOriginalContexts);

			// code under test
			oBinding.setContext();
			assert.strictEqual(oBinding.aContexts.length, 0, "reset context");
		}

		oControl.bindObject("/TEAMS('4711')");
		that.oSandbox.mock(oControl.getObjectBinding()).expects("requestValue")
			.withExactArgs(sPath, undefined)
			.returns(oPromise);

		// code under test
		oControl.bindAggregation("items", jQuery.extend({
				path : sPath,
				template : new TestControl()
			}, oRange));

		oBinding = oControl.getBinding("items");
		oBinding.attachEventOnce("change", onChange);

		return oPromise;
	});

	//*********************************************************************************************
	QUnit.test("nested listbinding (context not yet set)", function (assert) {
		var oControl = new TestControl({models : this.oModel}),
			oRange = {startIndex : 1, length : 3};

		// change event handler for initial read for list binding
		function onChange() {
			assert.ok(false, "unexpected event called");
		}

		// code under test
		oControl.bindAggregation("items", jQuery.extend({
				path : "TEAM_2_EMPLOYEES",
				template : new TestControl()
			}, oRange));

		oControl.getBinding("items").attachChange(onChange);
		assert.deepEqual(oControl.getBinding("items").getContexts(), [],
			"list binding contexts not set");
	});

	//*********************************************************************************************
	QUnit.test("initialize, resolved path", function (assert) {
		var oContext = {},
			oListBinding = this.oModel.bindList("foo", oContext);

		this.mock(this.oModel).expects("resolve").withExactArgs("foo", sinon.match.same(oContext))
			.returns("/absolute");
		this.mock(oListBinding).expects("_fireChange")
			.withExactArgs({reason : ChangeReason.Change});

		assert.strictEqual(oListBinding.initialize(), undefined, "no chaining");
	});

	//*********************************************************************************************
	QUnit.test("initialize, unresolved path", function () {
		var oListBinding = this.oModel.bindList("Suppliers");

		this.mock(this.oModel).expects("resolve")
			.returns(undefined /*relative path, no context*/);
		this.mock(oListBinding).expects("_fireChange").never();

		oListBinding.initialize();
	});

	//*********************************************************************************************
	QUnit.test("setContext, change event", function (assert) {
		var oContext = {},
			oListBinding = this.oModel.bindList("Suppliers");

		this.mock(oListBinding).expects("_fireChange")
			.withExactArgs({reason : ChangeReason.Context});

		oListBinding.setContext(oContext);
	});

	//*********************************************************************************************
	QUnit.test("getContexts called directly provides contexts as return value and in change event",
		function (assert) {
		var done = assert.async(),
			oCacheMock = this.getCacheMock(),
			oListBinding = this.oModel.bindList("/EMPLOYEES"),
			oListBindingMock = this.oSandbox.mock(oListBinding),
			iSizeLimit = this.oModel.iSizeLimit,
			iRangeIndex = 0,
			// fixture with array of ranges for getContexts calls with
			//   start, length - determine the range
			//   sync - array with flags which indexes are to return a context synchronously to
			//     simulate previous calls to getContexts
			oFixture  = [
				{sync : []},
				// completely new contexts
				{start : iSizeLimit, length : 1, sync : []},
				// partially new contexts
				{start : iSizeLimit, length : 2, sync : [true]},
				// completely existing contexts
				{start : iSizeLimit, length : 2, sync : [true, true]}
			];

		// call getContexts for current range; considers previously accessed indexes
		// only if used to check synchronous return value of getContexts.
		function checkContexts(bSync) {
			var aContexts,
				i,
				iLength = oFixture[iRangeIndex].length || iSizeLimit,
				sMessage,
				iStart = oFixture[iRangeIndex].start || 0,
				oPromise;

			if (bSync && iRangeIndex < oFixture.length - 1) {
				oCacheMock.expects("read").withArgs(iStart, iLength, "")
					.returns(createResult(iLength));
			}

			// code under test, read synchronously with previous range
			aContexts = oListBinding.getContexts(iStart, iLength);

			for (i = 0; i < iLength; i += 1) {
				sMessage = (bSync ? "Synchronous" : "Asynchronous") + " result"
					+ "/EMPLOYEES/" + (iStart + i) + ", getContexts("
					+ iStart + "," + iLength + ")";
				if (bSync && !oFixture[iRangeIndex].sync[i]) {
					assert.strictEqual(aContexts[i], undefined, sMessage);
				} else {
					assert.strictEqual(aContexts[i].getPath(),
						"/EMPLOYEES/" + (iStart + i),
						sMessage);
					//check delegation of requestValue from context
					oPromise = {}; // a fresh new object each turn around
					oListBindingMock.expects("requestValue")
						.withExactArgs("foo/bar/" + i, iStart + i)
						.returns(oPromise);

					assert.strictEqual(aContexts[i].requestValue("foo/bar/" + i), oPromise);
				}
			}
		}

		// change event handler for list binding
		function onChange() {
			checkContexts();
			iRangeIndex += 1;
			checkContexts(true);
			// only the last range in the fixture triggers no change event
			if (iRangeIndex === oFixture.length - 1) {
				done();
			}
		}

		checkContexts(true);
		oListBinding.attachChange(onChange);
	});

	//*********************************************************************************************
	[false, true].forEach(function (bRelative) {
		QUnit.test("getContexts sends no change event on failure of _Cache#read and logs error, "
				+ "path is relative: " + bRelative, function (assert) {
			var oCacheMock,
				oContext = {
					getPath : function () { return "/EMPLOYEES(1)"; },
					requestValue : function () {}
				},
				oContextMock,
				oError = new Error("Intentionally failed"),
				oListBinding,
				oPromise = Promise.reject(oError),
				sResolvedPath = bRelative
					? "/service/EMPLOYEES(1)/TEAM_2_EMPLOYEES"
					: "/service/EMPLOYEES";

			if (bRelative) {
				oContextMock = this.oSandbox.mock(oContext);
				oContextMock.expects("requestValue").once().returns(createResult(2));
				oContextMock.expects("requestValue").once().returns(oPromise);
				// no error logged by ODataListBinding; parent context logged the error already
			} else {
				oCacheMock = this.getCacheMock();
				oCacheMock.expects("read").once().callsArg(4).returns(createResult(2));
				oCacheMock.expects("read").once().callsArg(4).returns(oPromise);
				this.oLogMock.expects("error")
					.withExactArgs("Failed to get contexts for " + sResolvedPath
							+ " with start index 1" + " and length 2",
						oError, "sap.ui.model.odata.v4.ODataListBinding");
			}

			oListBinding = this.oModel.bindList(bRelative ? "TEAM_2_EMPLOYEES" : "/EMPLOYEES",
					oContext);
			oListBinding.attachChange(function () {
				// code under test
				var aContexts = oListBinding.getContexts(1, 2); // failing read

				assert.strictEqual(aContexts.length, 1, "contexts from first read still exist");
			});
			oListBinding.getContexts(0, 2); // successful read

			return oPromise["catch"](function () {
				assert.ok(true);
			});
			//TODO implement faultTolerant setting on list binding which keeps existing contexts?
		});
	});

	//*********************************************************************************************
	[
		{start : 0, result : 0, isFinal : true, length : 0, text : "no data"},
		{start : 20, result : 29, isFinal : true, length : 49, text : "less data than requested"},
		{start : 20, result : 0, isFinal : false, length : 10, changeEvent : false,
			text : "no data for given start > 0"},
		{start : 20, result : 30, isFinal : false, length : 60, text : "maybe more data"}
	].forEach(function (oFixture) {
		QUnit.test("paging: " + oFixture.text, function (assert) {
			var oContext = {
					requestValue : function () {
						assert.ok(false, "context must be ignored for absolute bindings");
					}
				},
				oListBinding,
				oPromise = createResult(oFixture.result);

			this.getCacheMock().expects("read").withArgs(oFixture.start, 30, "").returns(oPromise);
			oListBinding = this.oModel.bindList("/EMPLOYEES", oContext);
			this.oSandbox.mock(oListBinding).expects("_fireChange")
				.exactly(oFixture.changeEvent === false ? 0 : 1)
				.withExactArgs({reason : ChangeReason.Change});

			assert.strictEqual(oListBinding.isLengthFinal(), false, "Length is not yet final");
			assert.strictEqual(oListBinding.getLength(), 10, "Initial estimated length is 10");

			oListBinding.getContexts(oFixture.start, 30);

			// attach then handler after ODataListBinding attached its then handler to be
			// able to check length and isLengthFinal
			return oPromise.then(function () {
				// if there are less entries returned than requested then final length is known
				assert.strictEqual(oListBinding.isLengthFinal(), oFixture.isFinal);
				assert.strictEqual(oListBinding.getLength(), oFixture.length);
			});
		});
	});

	//*********************************************************************************************
	[
		{start : 40, result : 5, isFinal : true, length : 45, text : "greater than before"},
		{start : 20, result : 5, isFinal : true, length : 25, text : "less than before"},
		{start : 0, result : 30, isFinal : true, length : 35, text : "full read before"},
		{start : 20, result : 30, isFinal : false, length : 60, text : "full read after"},
		{start : 15, result : 0, isFinal : true, length : 15, text : "empty read before"},
		{start : 40, result : 0, isFinal : true, length : 35, text : "empty read after"}
	].forEach(function (oFixture) {
		QUnit.test("paging: adjust final length: " + oFixture.text, function (assert) {
			var oCacheMock = this.getCacheMock(),
				oListBinding = this.oModel.bindList("/EMPLOYEES"),
				i, n,
				oReadPromise1 = createResult(15),
				oReadPromise2 = Promise.resolve(createResult(oFixture.result));

			oCacheMock.expects("read").withArgs(20, 30, "").returns(oReadPromise1);
			oCacheMock.expects("read").withArgs(oFixture.start, 30, "")
				.returns(oReadPromise2);

			oListBinding.getContexts(20, 30); // creates cache

			return oReadPromise1.then(function () {
				assert.strictEqual(oListBinding.isLengthFinal(), true);
				assert.strictEqual(oListBinding.getLength(), 35);
				oListBinding.getContexts(oFixture.start, 30);

				return oReadPromise2;
			}).then(function () {
				assert.strictEqual(oListBinding.isLengthFinal(), oFixture.isFinal, "final");
				assert.strictEqual(oListBinding.getLength(), oFixture.length);
				assert.strictEqual(oListBinding.aContexts.length,
					oFixture.length - (oFixture.isFinal ? 0 : 10), "Context array length");
				for (i = oFixture.start, n = oFixture.start + oFixture.result; i < n; i++) {
					assert.strictEqual(oListBinding.aContexts[i].sPath,
						"/EMPLOYEES/" + i, "check content");
				}
			});
		});
	});

	//*********************************************************************************************
	QUnit.test("paging: full read before length; length at boundary", function (assert) {
		var oCacheMock = this.getCacheMock(),
			oListBinding = this.oModel.bindList("/EMPLOYEES"),
			oReadPromise1 = createResult(30),
			oReadPromise2 = createResult(30),
			oReadPromise3 = createResult(0);

		// 1. read and get [20..50) -> estimated length 60
		oCacheMock.expects("read").withArgs(20, 30, "").returns(oReadPromise1);
		// 2. read and get [0..30) -> length still 60
		oCacheMock.expects("read").withArgs(0, 30, "").returns(oReadPromise2);
		// 3. read [50..80) get no entries -> length is now final 50
		oCacheMock.expects("read").withArgs(50, 30, "").returns(oReadPromise3);

		oListBinding.getContexts(20, 30);

		return oReadPromise1.then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), false);
			assert.strictEqual(oListBinding.getLength(), 60);

			oListBinding.getContexts(0, 30); // read more data from beginning

			return oReadPromise2;
		}).then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), false, "still not final");
			assert.strictEqual(oListBinding.getLength(), 60, "length not reduced");

			oListBinding.getContexts(50, 30); // no more data; length at paging boundary

			return oReadPromise3;
		}).then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), true, "now final");
			assert.strictEqual(oListBinding.getLength(), 50, "length at boundary");
		});
	});

	//*********************************************************************************************
	QUnit.test("paging: lower boundary reset", function (assert) {
		var oCacheMock = this.getCacheMock(),
			oListBinding = this.oModel.bindList("/EMPLOYEES"),
			oReadPromise1 = createResult(15),
			oReadPromise2 = createResult(0),
			oReadPromise3 = createResult(0);

		// 1. read [20..50) and get [20..35) -> final length 35
		oCacheMock.expects("read").withArgs(20, 30, "").returns(oReadPromise1);
		// 2. read [30..60) and get no entries -> estimated length 10 (after lower boundary reset)
		oCacheMock.expects("read").withArgs(30, 30, "").returns(oReadPromise2);
		// 3. read [35..65) and get no entries -> estimated length still 10
		oCacheMock.expects("read").withArgs(35, 30, "").returns(oReadPromise3);

		oListBinding.getContexts(20, 30);

		return oReadPromise1.then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), true);
			assert.strictEqual(oListBinding.getLength(), 35);
			assert.strictEqual(oListBinding.aContexts.length, 35);

			oListBinding.getContexts(30, 30);

			return oReadPromise2;
		}).then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), true, "new lower boundary");
			assert.strictEqual(oListBinding.getLength(), 30,
				"length 10 (after lower boundary reset)");
			assert.strictEqual(oListBinding.aContexts.length, 30, "contexts array reduced");

			oListBinding.getContexts(35, 30);

			return oReadPromise3;
		}).then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), true, "still estimated");
			assert.strictEqual(oListBinding.getLength(), 30, "still 30");
		});
	});

	//*********************************************************************************************
	QUnit.test("paging: adjust max length got from server", function (assert) {
		var oCacheMock = this.getCacheMock(),
			oListBinding = this.oModel.bindList("/EMPLOYEES"),
			oReadPromise1 = createResult(15),
			oReadPromise2 = createResult(14),
			oReadPromise3 = createResult(0);

		// 1. read [20..50) and get [20..35) -> final length 35
		oCacheMock.expects("read").withArgs(20, 30, "").returns(oReadPromise1);
		// 2. read [20..50) and get [20..34) -> final length 34
		oCacheMock.expects("read").withArgs(20, 30, "").returns(oReadPromise2);
		// 3. read [35..65) and get no entries -> final length still 34
		oCacheMock.expects("read").withArgs(35, 30, "").returns(oReadPromise3);

		oListBinding.getContexts(20, 30);

		return oReadPromise1.then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), true);
			assert.strictEqual(oListBinding.getLength(), 35);

			oListBinding.getContexts(20, 30);

			return oReadPromise2;
		}).then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), true, "final 34");
			assert.strictEqual(oListBinding.getLength(), 34, "length 34");

			oListBinding.getContexts(35, 30);

			return oReadPromise3;
		}).then(function () {
			assert.strictEqual(oListBinding.isLengthFinal(), true, "still final");
			assert.strictEqual(oListBinding.getLength(), 34, "length still 34");
		});
	});

	//*********************************************************************************************
	QUnit.test("refresh", function (assert) {
		var oCacheMock = this.getCacheMock(),
			oListBinding = this.oModel.bindList("/EMPLOYEES"),
			oListBindingMock = this.oSandbox.mock(oListBinding),
			oReadPromise = createResult(9);

		// change event during getContexts
		oListBindingMock.expects("_fireChange")
			.withExactArgs({reason : ChangeReason.Change});
		// refresh event during refresh
		oListBindingMock.expects("_fireRefresh")
			.withExactArgs({reason : ChangeReason.Refresh});
		oCacheMock.expects("read").withArgs(0, 10, "").returns(oReadPromise);
		oCacheMock.expects("refresh");

		oListBinding.getContexts(0, 10);

		return oReadPromise.then(function () {
			var oCache = oListBinding.oCache;
			assert.strictEqual(oListBinding.iMaxLength, 9);
			assert.strictEqual(oListBinding.isLengthFinal(), true);

			//code under test
			oListBinding.refresh(true);

			assert.strictEqual(oListBinding.oCache, oCache);
			assert.deepEqual(oListBinding.aContexts, []);
			assert.strictEqual(oListBinding.iMaxLength, Infinity);
			assert.strictEqual(oListBinding.isLengthFinal(), false);
		});
	});

	//*********************************************************************************************
	QUnit.test("refresh on relative binding is not supported", function (assert) {
		var oListBinding = this.oModel.bindList("EMPLOYEES"),
			oListBindingMock = this.oSandbox.mock(oListBinding);

		this.oSandbox.mock(_Cache).expects("create").never();
		// refresh event during refresh
		oListBindingMock.expects("_fireRefresh").never();

		//code under test
		//error for relative paths
		assert.throws(function () {
			oListBinding.refresh(true);
		}, new Error("Refresh on this binding is not supported"));
	});

	//*********************************************************************************************
	QUnit.test("refresh cancels pending getContexts", function (assert) {
		var oCacheMock = this.getCacheMock(),
			oError = new Error(),
			oListBinding = this.oModel.bindList("/EMPLOYEES"),
			oListBindingMock = this.oSandbox.mock(oListBinding),
			oReadPromise = Promise.reject(oError);

		// change event during getContexts
		oListBindingMock.expects("_fireChange").never();
		oListBindingMock.expects("fireDataReceived").withExactArgs();
		oError.canceled = true;
		oCacheMock.expects("read").withArgs(0, 10, "").callsArg(4).returns(oReadPromise);
		oCacheMock.expects("refresh");

		oListBinding.getContexts(0, 10);
		oListBinding.refresh(true);

		return oReadPromise["catch"](function () {});
	});

	//*********************************************************************************************
	QUnit.test("getContexts fires dataRequested and dataReceived events", function (assert) {
		var oListBinding = this.oModel.bindList("/EMPLOYEES"),
			fnResolveRead,
			oReadPromise = new Promise(function (fnResolve) {fnResolveRead = fnResolve;}),
			oSandbox = this.oSandbox;

		// read returns an unresolved Promise to be resolved by submitBatch; otherwise this Promise
		// would be resolved before the rendering and dataReceived would be fired before
		// dataRequested
		oSandbox.mock(oListBinding.oCache).expects("read").callsArg(4).returns(oReadPromise);
		oSandbox.stub(this.oModel.oRequestor, "submitBatch", function () {
			var oListBindingMock = oSandbox.mock(oListBinding);

			// These events must be fired _after_ submitBatch
			oListBindingMock.expects("fireEvent")
				.withExactArgs("dataRequested", undefined);
			oListBindingMock.expects("fireEvent")
				.withExactArgs("change", {reason : "change"});
			oSandbox.stub(oListBinding, "fireDataReceived", function () {
				assert.strictEqual(oListBinding.aContexts.length, 10, "data already processed");
			});

			// submitBatch resolves the promise of the read
			fnResolveRead(createResult(10));
		});

		oListBinding.getContexts(0, 10);

		return oReadPromise.then(function () {
			sinon.assert.calledOnce(oListBinding.fireDataReceived);
		});
	});

	//*********************************************************************************************
	QUnit.test("getContexts - error handling for dataRequested/dataReceived", function (assert) {
		var oError = new Error("Expected Error"),
			oListBinding = this.oModel.bindList("/EMPLOYEES"),
			oReadPromise = Promise.reject(oError);

		this.oLogMock.expects("error")
			.withExactArgs("Failed to get contexts for /service/EMPLOYEES with start index 0 and "
				+ "length 10", oError, "sap.ui.model.odata.v4.ODataListBinding");
		this.oSandbox.mock(oListBinding.oCache).expects("read").callsArg(4).returns(oReadPromise);
		this.oSandbox.mock(oListBinding).expects("fireDataReceived")
			.withExactArgs({error : oError});

		oListBinding.getContexts(0, 10);
		return oReadPromise["catch"](function () {});
	});

	//*********************************************************************************************
	QUnit.test("getContexts - concurrent call with read errors", function (assert) {
		var oCacheMock,
			oError = new Error("Expected Error"),
			oListBinding = this.oModel.bindList("/EMPLOYEES"),
			fnRejectRead,
			oReadPromise = new Promise(function (fn, fnReject) {fnRejectRead = fnReject;}),
			oSandbox = this.oSandbox;

		this.oLogMock.expects("error")
			.withExactArgs("Failed to get contexts for /service/EMPLOYEES with start index 0 and "
				+ "length 10", oError, "sap.ui.model.odata.v4.ODataListBinding");
		oCacheMock = oSandbox.mock(oListBinding.oCache);
		oCacheMock.expects("read").callsArg(4).returns(oReadPromise);
		oCacheMock.expects("read").returns(oReadPromise);
		oSandbox.stub(this.oModel.oRequestor, "submitBatch", function () {
			oSandbox.mock(oListBinding).expects("fireEvent")
				.withExactArgs("dataRequested", undefined);
			oSandbox.mock(oListBinding).expects("fireDataReceived")
				.withExactArgs({error : oError});

			// submitBatch resolves the promise of the read
			fnRejectRead(oError);
		});

		oListBinding.getContexts(0, 10);
		// call it again in parallel
		oListBinding.getContexts(0, 10);

		return oReadPromise["catch"](function () {});
	});

	//*********************************************************************************************
	QUnit.test("requestValue: absolute binding", function (assert) {
		var oListBinding = this.oModel.bindList("/EMPLOYEES"),
			oPromise = {};

		this.oSandbox.mock(oListBinding.oCache).expects("read")
			.withExactArgs(42, 1, undefined, "bar")
			.returns(oPromise);

		assert.strictEqual(oListBinding.requestValue("bar", 42), oPromise);
	});
	//TODO support dataRequested/dataReceived event in requestValue:
	//     common implementation used by requestValue and getContexts?

	//*********************************************************************************************
	QUnit.test("requestValue: relative binding", function (assert) {
		var oContext = {
				requestValue : function () {}
			},
			oContextMock = this.oSandbox.mock(oContext),
			oListBinding = this.oModel.bindList("TEAM_2_EMPLOYEES", oContext),
			oPromise = {};

		oContextMock.expects("requestValue")
			.withExactArgs("TEAM_2_EMPLOYEES/42/bar")
			.returns(oPromise);

		assert.strictEqual(oListBinding.requestValue("bar", 42), oPromise);

		oContextMock.expects("requestValue")
			.withExactArgs("TEAM_2_EMPLOYEES/42")
			.returns(oPromise);

		assert.strictEqual(oListBinding.requestValue("", 42), oPromise);
	});
	//TODO provide iStart, iLength parameter to requestValue to support paging on nested list

	//*********************************************************************************************
	QUnit.test("getContexts calls dataRequested", function (assert) {
		var oListBinding;

		this.oSandbox.stub(_Cache, "create", function (oRequestor, sUrl, mQueryOptions) {
			return {
				read: function (iIndex, iLength, sGroupId, sPath, fnDataRequested) {
					fnDataRequested();
					return createResult(iLength, iIndex);
				}
			};
		});
		this.oSandbox.mock(this.oModel).expects("dataRequested")
			.withExactArgs("", sinon.match.typeOf("function"));

		oListBinding = this.oModel.bindList("/EMPLOYEES");

		return oListBinding.getContexts(0, 10);
	});

	//*********************************************************************************************
	QUnit.test("forbidden", function (assert) {
		var oListBinding = this.oModel.bindList("/EMPLOYEES");

		assert.throws(function () { //TODO implement
			oListBinding.filter();
		}, new Error("Unsupported operation: v4.ODataListBinding#filter"));

		assert.throws(function () { //TODO implement?
			oListBinding.getContexts(0, 42, 0);
		}, new Error("Unsupported operation: v4.ODataListBinding#getContexts, "
				+ "iThreshold parameter must not be set"));

		assert.throws(function () { //TODO implement
			oListBinding.getCurrentContexts();
		}, new Error("Unsupported operation: v4.ODataListBinding#getCurrentContexts"));

		assert.throws(function () {
			oListBinding.getDistinctValues();
		}, new Error("Unsupported operation: v4.ODataListBinding#getDistinctValues"));

		assert.throws(function () { //TODO implement
			oListBinding.isInitial();
		}, new Error("Unsupported operation: v4.ODataListBinding#isInitial"));

		assert.throws(function () { //TODO implement
			oListBinding.refresh(false);
		}, new Error("Unsupported operation: v4.ODataListBinding#refresh, "
			+ "bForceUpdate must be true"));
		assert.throws(function () {
			oListBinding.refresh("foo"/*truthy*/);
		}, new Error("Unsupported operation: v4.ODataListBinding#refresh, "
			+ "bForceUpdate must be true"));
		assert.throws(function () { //TODO implement
			oListBinding.refresh(true, "");
		}, new Error("Unsupported operation: v4.ODataListBinding#refresh, "
				+ "sGroupId parameter must not be set"));

		assert.throws(function () { //TODO implement
			oListBinding.resume();
		}, new Error("Unsupported operation: v4.ODataListBinding#resume"));

		assert.throws(function () { //TODO implement
			oListBinding.sort();
		}, new Error("Unsupported operation: v4.ODataListBinding#sort"));

		assert.throws(function () { //TODO implement
			oListBinding.suspend();
		}, new Error("Unsupported operation: v4.ODataListBinding#suspend"));
	});
	//TODO errors on _fireFilter(mArguments) and below in Wiki

	//*********************************************************************************************
	QUnit.test("events", function (assert) {
		var mEventParameters = {},
			oListBinding,
			oReturn = {};

		this.oSandbox.mock(ListBinding.prototype).expects("attachEvent")
			.withExactArgs("change", mEventParameters).returns(oReturn);

		oListBinding = this.oModel.bindList("/EMPLOYEES");

		assert.throws(function () {
			oListBinding.attachEvent("filter");
		}, new Error("Unsupported event 'filter': v4.ODataListBinding#attachEvent"));

		assert.throws(function () {
			oListBinding.attachEvent("sort");
		}, new Error("Unsupported event 'sort': v4.ODataListBinding#attachEvent"));

		assert.strictEqual(oListBinding.attachEvent("change", mEventParameters), oReturn);
	});

	//*********************************************************************************************
	QUnit.test("Use model's groupId", function (assert) {
		var oBinding = this.oModel.bindList("/EMPLOYEES"),
			oReadPromise = createResult(0);

		this.oSandbox.mock(oBinding.oModel).expects("getGroupId").withExactArgs()
			.returns("groupId");
		this.oSandbox.mock(oBinding.oCache).expects("read").withArgs(0, 10, "groupId").callsArg(4)
			.returns(oReadPromise);
		this.oSandbox.mock(oBinding.oModel).expects("dataRequested").withArgs("groupId");

		oBinding.getContexts(0, 10);
		return oReadPromise;
	});
});
//TODO to avoid complete re-rendering of lists implement bUseExtendedChangeDetection support
//The implementation of getContexts needs to provide next to the resulting context array a diff
//array with information which entry has been inserted or deleted (see jQuery.sap.arrayDiff and
//sap.m.GrowingEnablement)
//TODO lists within lists for deferred navigation or structural properties

//TODO setContext() must delete this.oCache when it has its own cache (e.g. scenario
//  where listbinding is not nested but has a context. This is currently not possible but
//  if you think on a relative binding "TEAMS" which becomes context "/" -> here the relative
//  binding must create the it's own cache which has to be deleted with setContext()

//TODO integration: 2 entity sets with same $expand, but different $select
//TODO support suspend/resume
