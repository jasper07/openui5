/*!
 * ${copyright}
 */
sap.ui.require([
	"sap/ui/model/BindingMode",
	"sap/ui/model/Model",
	"sap/ui/model/odata/type/String",
	"sap/ui/model/odata/ODataUtils",
	"sap/ui/model/odata/v4/_Context",
	"sap/ui/model/odata/v4/_ODataHelper",
	"sap/ui/model/odata/v4/lib/_MetadataRequestor",
	"sap/ui/model/odata/v4/lib/_Requestor",
	"sap/ui/model/odata/v4/ODataContextBinding",
	"sap/ui/model/odata/v4/ODataListBinding",
	"sap/ui/model/odata/v4/ODataMetaModel",
	"sap/ui/model/odata/v4/ODataModel",
	"sap/ui/model/odata/v4/ODataPropertyBinding",
	"sap/ui/test/TestUtils"
], function (BindingMode, Model, TypeString, ODataUtils, _Context, _ODataHelper, _MetadataRequestor,
		_Requestor, ODataContextBinding, ODataListBinding, ODataMetaModel, ODataModel,
		ODataPropertyBinding, TestUtils) {
	/*global QUnit, sinon */
	/*eslint max-nested-callbacks: 0, no-warning-comments: 0 */
	"use strict";

	/*
	 * You can run various tests in this module against a real OData v4 service using the request
	 * property "realOData". See src/sap/ui/test/TestUtils.js for details.
	 */

	var mFixture = {
			"TEAMS('TEAM_01')/Name" : {source : "Name.json"},
			"TEAMS('UNKNOWN')" : {code : 404, source : "TEAMS('UNKNOWN').json"}
		},
		TestControl = sap.ui.core.Element.extend("test.sap.ui.model.odata.v4.ODataModel", {
			metadata : {
				properties : {
					text : "string"
				}
			}
		});

	/**
	 * Creates a v4 OData service for <code>TEA_BUSI</code>.
	 *
	 * @param {string} [sQuery] URI query parameters starting with '?'
	 * @returns {sap.ui.model.odata.v4.oDataModel} the model
	 */
	function createModel(sQuery) {
		return new ODataModel(getServiceUrl() + (sQuery || ""));
	}

	/**
	 * Returns a URL within the service that (in case of <code>bRealOData</code>), is passed
	 * through a proxy.
	 *
	 * @param {string} [sPath]
	 *   relative path (with initial /) within service
	 * @returns {string}
	 *   a URL within the service
	 */
	function getServiceUrl(sPath) {
		var sAbsolutePath = "/sap/opu/odata4/IWBEP/TEA/default/IWBEP/TEA_BUSI/0001/"
				+ (sPath && sPath.slice(1) || "");

		return TestUtils.proxy(sAbsolutePath);
	}

	//*********************************************************************************************
	QUnit.module("sap.ui.model.odata.v4.ODataModel", {
		beforeEach : function () {
			this.oSandbox = sinon.sandbox.create();
			TestUtils.setupODataV4Server(this.oSandbox, mFixture, undefined,
				"/sap/opu/odata4/IWBEP/TEA/default/IWBEP/TEA_BUSI/0001/");
			this.oLogMock = this.oSandbox.mock(jQuery.sap.log);
			this.oLogMock.expects("warning").never();
			this.oLogMock.expects("error").never();
			this.oSandbox.mock(sap.ui.getCore().getConfiguration()).expects("getLanguageTag")
				.atLeast(0).returns("ab-CD");
		},

		afterEach : function () {
			// I would consider this an API, see https://github.com/cjohansen/Sinon.JS/issues/614
			this.oSandbox.verifyAndRestore();
		}
	});

	//*********************************************************************************************
	QUnit.test("basics", function (assert) {
		var mHeaders = {
				"Accept-Language" : "ab-CD"
			},
			oHelperMock = this.mock(_ODataHelper),
			oMetadataRequestor = {},
			oMetadataRequestorMock = this.mock(_MetadataRequestor),
			oMetaModel,
			oModel,
			mModelOptions = {};

		assert.throws(function () {
			return new ODataModel();
		}, new Error("Missing service root URL"));
		assert.throws(function () {
			return new ODataModel("/foo");
		}, new Error("Service root URL must end with '/'"));

		assert.strictEqual(new ODataModel("/foo/").sServiceUrl, "/foo/");
		assert.strictEqual(new ODataModel({"serviceUrl" : "/foo/"}).sServiceUrl, "/foo/",
			"serviceUrl in mParameters");
		assert.strictEqual(new ODataModel("/foo/", {"serviceUrl" : "/bar/"}).sServiceUrl, "/foo/",
			"explicit service URL parameter wins over serviceUrl in mParameters");

		oHelperMock.expects("buildQueryOptions").returns(mModelOptions);
		oMetadataRequestorMock.expects("create").withExactArgs(mHeaders, mModelOptions)
			.returns(oMetadataRequestor);
		//code under test
		oModel = new ODataModel("/foo/");
		assert.strictEqual(oModel.mUriParameters, mModelOptions);

		oHelperMock.expects("buildQueryOptions").withExactArgs({"sap-client" : "111"})
			.returns(mModelOptions);
		oMetadataRequestorMock.expects("create").withExactArgs(mHeaders, mModelOptions)
			.returns(oMetadataRequestor);
		//code under test
		oModel = new ODataModel("/foo/?sap-client=111");
		assert.strictEqual(oModel.sServiceUrl, "/foo/");
		assert.strictEqual(oModel.mUriParameters, mModelOptions);
		assert.strictEqual(oModel.getDefaultBindingMode(), BindingMode.TwoWay);
		assert.strictEqual(oModel.isBindingModeSupported(BindingMode.OneTime), true);
		assert.strictEqual(oModel.isBindingModeSupported(BindingMode.OneWay), true);
		assert.strictEqual(oModel.isBindingModeSupported(BindingMode.TwoWay), true);
		oMetaModel = oModel.getMetaModel();
		assert.ok(oMetaModel instanceof ODataMetaModel);
		assert.strictEqual(oMetaModel.oRequestor, oMetadataRequestor);
		assert.strictEqual(oMetaModel.sUrl, "/foo/$metadata");

		oHelperMock.expects("buildQueryOptions").withExactArgs({"sap-client" : "111"})
			.returns(mModelOptions);
		oMetadataRequestorMock.expects("create").withExactArgs(mHeaders, mModelOptions)
			.returns(oMetadataRequestor);
		//code under test, serviceUrlParams overwrite URL parameters from this.sServiceUrl
		oModel = new ODataModel("/foo/?sap-client=222",
			{serviceUrlParams : {"sap-client" : "111"}});
	});

	//*********************************************************************************************
	QUnit.test("Model construction with default group", function (assert) {
		var oModel;

		oModel = new ODataModel("/");
		assert.strictEqual(oModel.getGroupId(), ""/*sGroupId for _Requestor#request*/);

		oModel = new ODataModel("/foo/", {defaultGroup : "$direct"});
		assert.strictEqual(oModel.getGroupId(), undefined);

		assert.throws(function () {
			oModel = new ODataModel("/foo/", {defaultGroup : "foo"});
		}, new Error("Default service group must be '$direct'"));
	});

	//*********************************************************************************************
	QUnit.test("Model creates _Requestor", function (assert) {
		var oModel,
			oRequestor = {};

		this.mock(_Requestor).expects("create").withExactArgs("/foo/", {
			"Accept-Language" : "ab-CD"
		}, {
			"sap-client" : "123"
		}).returns(oRequestor);

		oModel = new ODataModel("/foo/?sap-client=123");

		assert.ok(oModel instanceof Model);
		assert.strictEqual(oModel.oRequestor, oRequestor);
	});

	//*********************************************************************************************
	QUnit.skip("Property access from ManagedObject w/o context binding", function (assert) {
		var oModel = createModel(),
			oControl = new TestControl({models : oModel}),
			done = assert.async();

		oControl.bindProperty("text", {
			path : "/TEAMS('TEAM_01')/Name",
			type : new TypeString()
		});
		// bindProperty creates an ODataPropertyBinding and calls its initialize which results in
		// checkUpdate and a request. The value is updated asynchronously via a change event later
		oControl.getBinding("text").attachChange(function () {
			assert.strictEqual(oControl.getText(), "Business Suite", "property value");
			done();
		});
	});

	//*********************************************************************************************
	QUnit.skip("Property access from ManagedObject w/ context binding", function (assert) {
		var oModel = createModel(),
			oControl = new TestControl({models : oModel}),
			done = assert.async();

		oControl.bindObject("/TEAMS('TEAM_01')");
		oControl.bindProperty("text", {
			path : "Name",
			type : new TypeString()
		});
		// bindProperty creates an ODataPropertyBinding and calls its initialize which results in
		// checkUpdate and a request. The value is updated asynchronously via a change event later
		oControl.getBinding("text").attachChange(function () {
			assert.strictEqual(oControl.getText(), "Business Suite", "property value");
			done();
		});
	});

	//*********************************************************************************************
	QUnit.test("getMetaModel", function (assert) {
		var oMetaModel = createModel().getMetaModel();

		assert.ok(oMetaModel instanceof ODataMetaModel);
	});

	//*********************************************************************************************
	[undefined, "?foo=bar"].forEach(function (sQuery) {
		QUnit.test("create", function (assert) {
			var oEmployeeData = {},
				oModel = createModel(sQuery),
				oPromise = {};

			this.mock(oModel.oRequestor).expects("request")
				//TODO remove usage of oModel._sQuery once cache is used for all CRUD operations
				.withExactArgs("POST", "EMPLOYEES" + oModel._sQuery, undefined, null,
					oEmployeeData).returns(oPromise);

			assert.strictEqual(oModel.create("/EMPLOYEES", oEmployeeData), oPromise);
		});
	});

	//*********************************************************************************************
	[undefined, "?foo=bar"].forEach(function (sQuery) {
		QUnit.test("remove", function (assert) {
			var sEtag = 'W/"19770724000000.0000000"',
				oModel = createModel(sQuery),
				sPath = "/EMPLOYEES/0",
				oContext = _Context.create(oModel, null, sPath);

			this.oSandbox.mock(oModel.oRequestor).expects("request")
				.withExactArgs("DELETE", "EMPLOYEES(ID='1')" + oModel._sQuery, undefined,
					{"If-Match" : sEtag})
				.returns(Promise.resolve(undefined));
			this.oSandbox.mock(oContext).expects("requestValue").withExactArgs("@odata.etag")
				.returns(Promise.resolve(sEtag));
			this.oSandbox.stub(oModel.getMetaModel(), "requestCanonicalUrl",
				function (sServiceUrl, sPath0, oContext0) {
					assert.strictEqual(sServiceUrl, "",
						"no service URL, return resource path only");
					assert.strictEqual(sPath0, sPath);
					assert.strictEqual(oContext0, oContext);
					return Promise.resolve("EMPLOYEES(ID='1')");
				});

			return oModel.remove(oContext).then(function (oResult) {
				assert.strictEqual(oResult, undefined);
			}, function (oError) {
				assert.ok(false);
			});
		});
	});
	//TODO trigger update in case of isConcurrentModification?!
	//TODO do it anyway? what and when to return, result of remove vs. re-read?

	//*********************************************************************************************
	[404, 500].forEach(function (iStatus) {
		QUnit.test("remove: map 404 to 200, status: " + iStatus, function (assert) {
			var oError = new Error(""),
				oModel = createModel(),
				oContext = _Context.create(oModel, null, "/EMPLOYEES/0");

			oError.status = iStatus;
			this.oSandbox.mock(oContext).expects("requestValue").withExactArgs("@odata.etag")
				.returns(Promise.resolve('W/""'));
			this.oSandbox.stub(oModel.getMetaModel(), "requestCanonicalUrl")
				.returns(Promise.resolve(getServiceUrl("/EMPLOYEES(ID='1')")));
			this.oSandbox.stub(oModel.oRequestor, "request")
				.returns(Promise.reject(oError));

			return oModel.remove(oContext)
				.then(function (oResult) {
					assert.strictEqual(oResult, undefined);
					assert.ok(iStatus === 404, "unexpected success");
				}, function (oError0) {
					assert.strictEqual(oError0, oError);
					assert.ok(iStatus !== 404, JSON.stringify(oError0));
				});
		});
	});

	//*********************************************************************************************
	QUnit.test("requestCanonicalPath fulfills", function (assert) {
		var oModel = createModel(),
			oEntityContext = _Context.create(oModel, null, "/EMPLOYEES/42"),
			oMetaModel = oModel.getMetaModel(),
			oMetaModelMock = this.oSandbox.mock(oMetaModel);

		oMetaModelMock.expects("requestCanonicalUrl")
			.withExactArgs("/", oEntityContext.getPath(), oEntityContext)
			.returns(Promise.resolve("/EMPLOYEES(ID='1')"));

		return oModel.requestCanonicalPath(oEntityContext).then(function (sCanonicalPath) {
			assert.strictEqual(sCanonicalPath, "/EMPLOYEES(ID='1')");
		});
	});

	//*********************************************************************************************
	QUnit.test("requestCanonicalPath rejects", function (assert) {
		var oError = new Error("Intentionally failed"),
			oModel = createModel(),
			oNotAnEntityContext = _Context.create(oModel, null, "/EMPLOYEES/42/Name"),
			oMetaModel = oModel.getMetaModel(),
			oMetaModelMock = this.oSandbox.mock(oMetaModel);

		oMetaModelMock.expects("requestCanonicalUrl")
			.returns(Promise.reject(oError));

		return oModel.requestCanonicalPath(oNotAnEntityContext).then(
			function () { assert.ok(false, "Unexpected success"); },
			function (oError0) { assert.strictEqual(oError0, oError); }
		);
	});

	//*********************************************************************************************
	QUnit.test("requestCanonicalPath, context from different model", function (assert) {
		var oModel = createModel(),
			oModel2 = createModel(),
			oEntityContext = _Context.create(oModel2, null, "/EMPLOYEES/42"),
			oMetaModel = oModel.getMetaModel(),
			oMetaModelMock = this.oSandbox.mock(oMetaModel);

		oMetaModelMock.expects("requestCanonicalUrl").returns(Promise.resolve(""));
		if (jQuery.sap.log.getLevel() > jQuery.sap.log.LogLevel.ERROR) { // not for minified code
			this.mock(jQuery.sap).expects("assert")
				.withExactArgs(false, "oEntityContext must belong to this model");
		}

		oModel.requestCanonicalPath(oEntityContext);
	});

	//*********************************************************************************************
	QUnit.test("refresh", function (assert) {
		var oModel = createModel(),
			oListBinding = oModel.bindList("/TEAMS"),
			oListBinding2 = oModel.bindList("/TEAMS"),
			oPropertyBinding = oModel.bindProperty("Name");

		oListBinding.attachChange(function () {});
		oPropertyBinding.attachChange(function () {});
		this.oSandbox.mock(oListBinding).expects("refresh").withExactArgs(true);
		//check: only bindings with change event handler are refreshed
		this.oSandbox.mock(oListBinding2).expects("refresh").never();
		//check: no refresh on binding with relative path
		this.oSandbox.mock(oPropertyBinding).expects("refresh").never();

		oModel.refresh(true);
	});

	//*********************************************************************************************
	QUnit.test("oModel.aBindings modified during refresh", function (assert) {
		var iCallCount = 0,
			oModel = createModel(),
			oListBinding = oModel.bindList("/TEAMS"),
			oListBinding2 = oModel.bindList("/TEAMS");

		function change() {}

		function detach() {
			this.detachChange(change); // removes binding from oModel.aBindings
			iCallCount += 1;
		}

		oListBinding.attachChange(change); // adds binding to oModel.aBindings
		oListBinding2.attachChange(change);
		oListBinding.attachRefresh(detach);
		oListBinding2.attachRefresh(detach);

		oModel.refresh(true);

		assert.strictEqual(iCallCount, 2, "refresh called for both bindings");
	});

	//*********************************************************************************************
	QUnit.test("dataRequested", function (assert) {
		var done = assert.async(),
			sGroupId1 = "group1",
			sGroupId2 = "group2",
			oModel = createModel(),
			fnSpy1 = sinon.spy(),
			fnSpy2 = sinon.spy(),
			oSandbox = this.oSandbox,
			oRequestorMock = oSandbox.mock(oModel.oRequestor);

		oRequestorMock.expects("submitBatch").never();

		// code under test
		oModel.dataRequested(sGroupId1, function () {
			oModel.dataRequested(sGroupId1, function () {
				assert.ok(fnSpy1.called, "second callback for group1");
				assert.ok(fnSpy2.called, "callback for group2");
				done();
			});

			oRequestorMock.expects("submitBatch").withExactArgs(sGroupId1);
		});
		oModel.dataRequested(sGroupId1, fnSpy1);
		oModel.dataRequested(sGroupId2, fnSpy2);

		// expect it afterwards so that we know that it has not been called synchronously
		oRequestorMock.expects("submitBatch").withExactArgs(sGroupId1);
		oRequestorMock.expects("submitBatch").withExactArgs(sGroupId2);

		assert.ok(!fnSpy1.called && !fnSpy2.called, "not called synchronously");
	});

	//*********************************************************************************************
	QUnit.test("dataRequested with group ID 'undefined'", function (assert) {
		var bDataRequested = false,
			oModel = createModel();

		this.oSandbox.mock(sap.ui.getCore()).expects("addPrerenderingTask").never();
		this.oSandbox.mock(oModel.oRequestor).expects("submitBatch").never();

		// code under test
		oModel.dataRequested(undefined, function () {
			bDataRequested = true;
		});

		assert.strictEqual(bDataRequested, true);
		assert.strictEqual("undefined" in oModel.mDataRequestedCallbacks, false);
	});

	//*********************************************************************************************
	QUnit.test("forbidden", function (assert) {
		var aFilters = [],
			oModel = createModel(),
			aSorters = [];

		assert.throws(function () { //TODO implement
			oModel.bindList(undefined, undefined,  undefined, aFilters);
		}, new Error("Unsupported operation: v4.ODataModel#bindList, "
				+ "aSorters parameter must not be set"));
		assert.throws(function () { //TODO implement
			oModel.bindList(undefined, undefined,  aSorters);
		}, new Error("Unsupported operation: v4.ODataModel#bindList, "
				+ "aFilters parameter must not be set"));

		assert.throws(function () { //TODO implement
			oModel.bindTree();
		}, new Error("Unsupported operation: v4.ODataModel#bindTree"));

		assert.throws(function () {
			oModel.createBindingContext();
		}, new Error("Unsupported operation: v4.ODataModel#createBindingContext"));

		assert.throws(function () {
			oModel.destroyBindingContext();
		}, new Error("Unsupported operation: v4.ODataModel#destroyBindingContext"));

		assert.throws(function () {
			oModel.getContext();
		}, new Error("Unsupported operation: v4.ODataModel#getContext"));

		assert.throws(function () { //TODO implement
			oModel.getOriginalProperty();
		}, new Error("Unsupported operation: v4.ODataModel#getOriginalProperty"));

		assert.throws(function () {
			oModel.getProperty();
		}, new Error("Unsupported operation: v4.ODataModel#getProperty"));

		assert.throws(function () { //TODO implement
			oModel.isList();
		}, new Error("Unsupported operation: v4.ODataModel#isList"));

		assert.throws(function () { //TODO implement
			oModel.refresh(false);
		}, new Error("Unsupported operation: v4.ODataModel#refresh, "
			+ "bForceUpdate must be true"));
		assert.throws(function () {
			oModel.refresh("foo"/*truthy*/);
		}, new Error("Unsupported operation: v4.ODataModel#refresh, "
			+ "bForceUpdate must be true"));
		assert.throws(function () { //TODO implement
			oModel.refresh(true, "");
		}, new Error("Unsupported operation: v4.ODataModel#refresh, "
				+ "sGroupId parameter must not be set"));

		assert.throws(function () {
			oModel.setLegacySyntax();
		}, new Error("Unsupported operation: v4.ODataModel#setLegacySyntax"));
	});

	//*********************************************************************************************
	QUnit.test("events", function (assert) {
		var oModel = createModel();

		assert.throws(function () {
			oModel.attachParseError();
		}, new Error("Unsupported event 'parseError': v4.ODataModel#attachEvent"));

		assert.throws(function () {
			oModel.attachRequestCompleted();
		}, new Error("Unsupported event 'requestCompleted': v4.ODataModel#attachEvent"));

		assert.throws(function () {
			oModel.attachRequestFailed();
		}, new Error("Unsupported event 'requestFailed': v4.ODataModel#attachEvent"));

		assert.throws(function () {
			oModel.attachRequestSent();
		}, new Error("Unsupported event 'requestSent': v4.ODataModel#attachEvent"));
	});
});
// TODO DefaultBindingMode is set to 'OneWay' now. It must be changed if we can 'TwoWay'
// TODO Extend mSupportedBindingModes for 'TwoWay'
// TODO constructor: test that the service root URL is absolute?
// TODO read: support the mParameters context, urlParameters, filters, sorters, batchGroupId
// TODO read etc.: provide access to "abort" functionality

// oResponse.headers look like this:
//Content-Type:application/json; odata.metadata=minimal;charset=utf-8
//etag:W/"20150915102433.7994750"
//location:.../sap/opu/odata4/IWBEP/TEA/default/IWBEP/TEA_BUSI/0001/EMPLOYEES('7')
//TODO can we make use of "location" header? relation to canonical URL?
// oData looks like this:
//{
//	"@odata.context" : "$metadata#EMPLOYEES",
//	"@odata.etag" : "W/\"20150915102433.7994750\"",
//}
//TODO can we make use of @odata.context in response data?
//TODO etag handling
//TODO use 'sap/ui/thirdparty/URI' for URL handling?

//TODO support "/#" syntax, e.g. "/EMPLOYEES(ID='1')/ENTRYDATE/#Type/QualifiedName"
//     do it for bindings, not as a JS API (getMetaModel().getMetaContext() etc. is already there)
