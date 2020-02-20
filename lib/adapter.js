/* eslint-disable prefer-arrow-callback */
/*---------------------------------------------------------------
  :: sails-sqlite3
  -> adapter

  Code refactored for Sails 1.0.0 release

  Supports Migratable interface, but (as docs on this interface
  stipulate) this should only be used for dev. This adapter
  does not implement the majority of possibly desired
  constraints since the waterline auto-migration is intended
  to be light and quick
---------------------------------------------------------------*/
/**
 * Module dependencies
 */

const fs = require('fs');

const _ = require('@sailshq/lodash');
const sqlite3 = require('sqlite3');
const Errors = require('waterline-errors').adapter;

const Query = require('./query');
const utils = require('./utils');


/**
 * Module state
 */

// Private var to track of all the datastores that use this adapter.  In order for your adapter
// to be able to connect to the database, you'll want to expose this var publicly as well.
// (See the `registerDatastore()` method for info on the format of each datastore entry herein.)
//
// > Note that this approach of process global state will be changing in an upcoming version of
// > the Waterline adapter spec (a breaking change).  But if you follow the conventions laid out
// > below in this adapter template, future upgrades should be a breeze.
var registeredDatastores = {};


/**
 * sails-sqlite3
 *
 * Expose the adapater definition.
 *
 * > Most of the methods below are optional.
 * >
 * > If you don't need / can't get to every method, just implement
 * > what you have time for.  The other methods will only fail if
 * > you try to call them!
 * >
 * > For many adapters, this file is all you need.  For very complex adapters, you may need more flexiblity.
 * > In any case, it's probably a good idea to start with one file and refactor only if necessary.
 * > If you do go that route, it's conventional in Node to create a `./lib` directory for your private submodules
 * > and `require` them at the top of this file with other dependencies. e.g.:
 * > ```
 * > var updateMethod = require('./lib/update');
 * > ```
 *
 * @type {Dictionary}
 */
const adapter = {


  // The identity of this adapter, to be referenced by datastore configurations in a Sails app.
  identity: 'sails-sqlite3',


  // Waterline Adapter API Version
  //
  // > Note that this is not necessarily tied to the major version release cycle of Sails/Waterline!
  // > For example, Sails v1.5.0 might generate apps which use sails-hook-orm@2.3.0, which might
  // > include Waterline v0.13.4.  And all those things might rely on version 1 of the adapter API.
  // > But Waterline v0.13.5 might support version 2 of the adapter API!!  And while you can generally
  // > trust semantic versioning to predict/understand userland API changes, be aware that the maximum
  // > and/or minimum _adapter API version_ supported by Waterline could be incremented between major
  // > version releases.  When possible, compatibility for past versions of the adapter spec will be
  // > maintained; just bear in mind that this is a _separate_ number, different from the NPM package
  // > version.  sails-hook-orm verifies this adapter API version when loading adapters to ensure
  // > compatibility, so you should be able to rely on it to provide a good error message to the Sails
  // > applications which use this adapter.
  adapterApiVersion: 1,


  // Default datastore configuration.
  defaults: {
    // Valid values are filenames, ":memory:" for an anonymous in-memory database and an empty string for an
    // anonymous disk-based database. Anonymous databases are not persisted and when closing the database handle,
    // their contents are lost.
    filename: "",
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    verbose: false
  },


  //  ╔═╗═╗ ╦╔═╗╔═╗╔═╗╔═╗  ┌─┐┬─┐┬┬  ┬┌─┐┌┬┐┌─┐
  //  ║╣ ╔╩╦╝╠═╝║ ║╚═╗║╣   ├─┘├┬┘│└┐┌┘├─┤ │ ├┤
  //  ╚═╝╩ ╚═╩  ╚═╝╚═╝╚═╝  ┴  ┴└─┴ └┘ ┴ ┴ ┴ └─┘
  //  ┌┬┐┌─┐┌┬┐┌─┐┌─┐┌┬┐┌─┐┬─┐┌─┐┌─┐
  //   ││├─┤ │ ├─┤└─┐ │ │ │├┬┘├┤ └─┐
  //  ─┴┘┴ ┴ ┴ ┴ ┴└─┘ ┴ └─┘┴└─└─┘└─┘
  // This allows outside access to this adapter's internal registry of datastore entries,
  // for use in datastore methods like `.leaseConnection()`.
  datastores: registeredDatastores,



  //////////////////////////////////////////////////////////////////////////////////////////////////
  //  ██╗     ██╗███████╗███████╗ ██████╗██╗   ██╗ ██████╗██╗     ███████╗                        //
  //  ██║     ██║██╔════╝██╔════╝██╔════╝╚██╗ ██╔╝██╔════╝██║     ██╔════╝                        //
  //  ██║     ██║█████╗  █████╗  ██║      ╚████╔╝ ██║     ██║     █████╗                          //
  //  ██║     ██║██╔══╝  ██╔══╝  ██║       ╚██╔╝  ██║     ██║     ██╔══╝                          //
  //  ███████╗██║██║     ███████╗╚██████╗   ██║   ╚██████╗███████╗███████╗                        //
  //  ╚══════╝╚═╝╚═╝     ╚══════╝ ╚═════╝   ╚═╝    ╚═════╝╚══════╝╚══════╝                        //
  //                                                                                              //
  // Lifecycle adapter methods:                                                                   //
  // Methods related to setting up and tearing down; registering/un-registering datastores.       //
  //////////////////////////////////////////////////////////////////////////////////////////////////

  /**
   *  ╦═╗╔═╗╔═╗╦╔═╗╔╦╗╔═╗╦═╗  ┌┬┐┌─┐┌┬┐┌─┐┌─┐┌┬┐┌─┐┬─┐┌─┐
   *  ╠╦╝║╣ ║ ╦║╚═╗ ║ ║╣ ╠╦╝   ││├─┤ │ ├─┤└─┐ │ │ │├┬┘├┤
   *  ╩╚═╚═╝╚═╝╩╚═╝ ╩ ╚═╝╩╚═  ─┴┘┴ ┴ ┴ ┴ ┴└─┘ ┴ └─┘┴└─└─┘
   * Register a new datastore with this adapter.  This usually involves creating a new
   * connection manager (e.g. MySQL pool or MongoDB client) for the underlying database layer.
   *
   * > Waterline calls this method once for every datastore that is configured to use this adapter.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Dictionary}   datastoreConfig            Dictionary (plain JavaScript object) of configuration options for this datastore (e.g. host, port, etc.)
   * @param  {Dictionary}   physicalModelsReport       Experimental: The physical models using this datastore (keyed by "tableName"-- NOT by `identity`!).  This may change in a future release of the adapter spec.
   *         @property {Dictionary} *  [Info about a physical model using this datastore.  WARNING: This is in a bit of an unusual format.]
   *                   @property {String} primaryKey        [the name of the primary key attribute (NOT the column name-- the attribute name!)]
   *                   @property {Dictionary} definition    [the physical-layer report from waterline-schema.  NOTE THAT THIS IS NOT A NORMAL MODEL DEF!]
   *                   @property {String} tableName         [the model's `tableName` (same as the key this is under, just here for convenience)]
   *                   @property {String} identity          [the model's `identity`]
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done                       A callback to trigger after successfully registering this datastore, or if an error is encountered.
   *               @param {Error?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  registerDatastore: async function (datastoreConfig, physicalModelsReport, done) {

    // Grab the unique name for this datastore for easy access below.
    var datastoreName = datastoreConfig.identity;

    // Some sanity checks:
    if (!datastoreName) {
      return done(new Error('Consistency violation: A datastore should contain an "identity" property: a special identifier that uniquely identifies it across this app.  This should have been provided by Waterline core!  If you are seeing this message, there could be a bug in Waterline, or the datastore could have become corrupted by userland code, or other code in this adapter.  If you determine that this is a Waterline bug, please report this at https://sailsjs.com/bugs.'));
    }
    if (registeredDatastores[datastoreName]) {
      return done(new Error('Consistency violation: Cannot register datastore: `' + datastoreName + '`, because it is already registered with this adapter!  This could be due to an unexpected race condition in userland code (e.g. attempting to initialize Waterline more than once), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    let writeClient;
    try {
      writeClient = await wrapAsyncStatements((cb) => {
        if (datastoreConfig.verbose) sqlite3.verbose();
        const writeClient = new sqlite3.Database(
          datastoreConfig.filename,
          datastoreConfig.mode,
          err => {
            if (!err) {
              //set write client to serialize mode
              writeClient.serialize();
            }

            cb(err, writeClient);
          }
        );
      });
      if (datastoreConfig.busyTimeout) {
        writeClient.configure('busyTimeout', datastoreConfig.busyTimeout)
      }
    } catch (err) {
      return done(err);
    }

    // To maintain the spirit of this repository, this implementation will
    // continue to spin up and tear down a connection to the Sqlite db on every
    // request.
    // TODO: Consider creating the connection and maintaining through the life
    // of the sails app. (This would lock it from changes outside sails)
    registeredDatastores[datastoreName] = {
      config: datastoreConfig,
      manager: {
        models: physicalModelsReport, //for reference
        schema: {},
        foreignKeys: utils.buildForeignKeyMap(physicalModelsReport),
        writeClient,
      },
      // driver: undefined // << TODO: include driver here (if relevant)
    };

    try {
      for (let tableName in physicalModelsReport) {
        await wrapAsyncStatements(this.describe.bind(this, datastoreName, tableName));
      }
    } catch (err) {
      return done(err);
    }

    return done();
  },


  /**
   *  ╔╦╗╔═╗╔═╗╦═╗╔╦╗╔═╗╦ ╦╔╗╔
   *   ║ ║╣ ╠═╣╠╦╝ ║║║ ║║║║║║║
   *   ╩ ╚═╝╩ ╩╩╚══╩╝╚═╝╚╩╝╝╚╝
   * Tear down (un-register) a datastore.
   *
   * Fired when a datastore is unregistered.  Typically called once for
   * each relevant datastore when the server is killed, or when Waterline
   * is shut down after a series of tests.  Useful for destroying the manager
   * (i.e. terminating any remaining open connections, etc.).
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String} datastoreName   The unique name (identity) of the datastore to un-register.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function} done          Callback
   *               @param {Error?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  teardown: function (datastoreName, done) {

    // Look up the datastore entry (manager/driver/config).
    var dsEntry = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Attempting to tear down a datastore (`' + datastoreName + '`) which is not currently registered with this adapter.  This is usually due to a race condition in userland code (e.g. attempting to tear down the same ORM instance more than once), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    // Close write client
    dsEntry.manager.writeClient.close();
    delete registeredDatastores[datastoreName];

    // Inform Waterline that we're done, and that everything went as expected.
    return done();

  },


  //////////////////////////////////////////////////////////////////////////////////////////////////
  //  ██████╗ ███╗   ███╗██╗                                                                      //
  //  ██╔══██╗████╗ ████║██║                                                                      //
  //  ██║  ██║██╔████╔██║██║                                                                      //
  //  ██║  ██║██║╚██╔╝██║██║                                                                      //
  //  ██████╔╝██║ ╚═╝ ██║███████╗                                                                 //
  //  ╚═════╝ ╚═╝     ╚═╝╚══════╝                                                                 //
  // (D)ata (M)anipulation (L)anguage                                                             //
  //                                                                                              //
  // DML adapter methods:                                                                         //
  // Methods related to manipulating records stored in the database.                              //
  //////////////////////////////////////////////////////////////////////////////////////////////////


  /**
   *  ╔═╗╦═╗╔═╗╔═╗╔╦╗╔═╗
   *  ║  ╠╦╝║╣ ╠═╣ ║ ║╣
   *  ╚═╝╩╚═╚═╝╩ ╩ ╩ ╚═╝
   * Create a new record.
   *
   * (e.g. add a new row to a SQL table, or a new document to a MongoDB collection.)
   *
   * > Note that depending on the value of `query.meta.fetch`,
   * > you may be expected to return the physical record that was
   * > created (a dictionary) as the second argument to the callback.
   * > (Otherwise, exclude the 2nd argument or send back `undefined`.)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done          Callback
   *               @param {Error?}
   *               @param {Dictionary?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  create: async function (datastoreName, query, done) {

    // normalize newRecords property
    query.newRecords = [query.newRecord];
    delete query.newRecord;

    try {
      const recordList = await wrapAsyncStatements(
        adapter.createEach.bind(adapter, datastoreName, query));

      let record;
      if (recordList && recordList.length >>> 0 > 0) {
        record = recordList[0];
      }
      done(undefined, record);
    } catch (err) {
      done(err);
    }
  },


  /**
   *  ╔═╗╦═╗╔═╗╔═╗╔╦╗╔═╗  ╔═╗╔═╗╔═╗╦ ╦
   *  ║  ╠╦╝║╣ ╠═╣ ║ ║╣   ║╣ ╠═╣║  ╠═╣
   *  ╚═╝╩╚═╚═╝╩ ╩ ╩ ╚═╝  ╚═╝╩ ╩╚═╝╩ ╩
   * Create multiple new records.
   *
   * > Note that depending on the value of `query.meta.fetch`,
   * > you may be expected to return the array of physical records
   * > that were created as the second argument to the callback.
   * > (Otherwise, exclude the 2nd argument or send back `undefined`.)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done            Callback
   *               @param {Error?}
   *               @param {Array?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  createEach: async function (datastoreName, query, done) {
    let verbose = false;

    // Look up the datastore entry (manager/driver/config).
    const dsEntry = registeredDatastores[datastoreName];
    const manager = dsEntry.manager;

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    try {
      const client = manager.writeClient;
      const tableName = query.using;
      const escapedTable = utils.escapeTable(tableName);

      const attributeSets = utils.mapAllAttributes(query.newRecords, manager.schema[tableName]);

      const columnNames = attributeSets.keys.join(', ');

      const paramValues = attributeSets.paramLists.map((paramList) => {
        return `( ${paramList.join(', ')} )`;
      }).join(', ');

      // Build query
      var insertQuery = `INSERT INTO ${escapedTable} (${columnNames}) values ${paramValues}`;
      var selectQuery = `SELECT * FROM ${escapedTable} ORDER BY rowid DESC LIMIT ${query.newRecords.length}`;

      // first insert values
      await wrapAsyncStatements(
        client.run.bind(client, insertQuery, attributeSets.values));

      // get the last inserted rows if requested
      const model = manager.models[tableName];
      let newRows;
      if (query.meta && query.meta.fetch) {
        newRows = [];
        const queryObj = new Query(tableName, manager.schema[tableName], model);

        await wrapAsyncStatements(client.each.bind(client, selectQuery, (err, row) => {
          if (err) throw err;

          newRows.push(queryObj.castRow(row));
        }));

        // resort for the order we were given the records.
        // we can guarantee that the first records will be given the
        // first available row IDs (even if some were deleted creating gaps),
        // so it's as easy as a sort using the primary key as the comparator
        let pkName = model.definition[model.primaryKey].columnName;
        newRows.sort((lhs, rhs) => {
          if (lhs[pkName] < rhs[pkName]) return -1;
          if (lhs[pkName] > rhs[pkName]) return 1;
          return 0;
        });
      }

      done(undefined, newRows);
    } catch (err) {
      done(err);
    }

  },



  /**
   *  ╦ ╦╔═╗╔╦╗╔═╗╔╦╗╔═╗
   *  ║ ║╠═╝ ║║╠═╣ ║ ║╣
   *  ╚═╝╩  ═╩╝╩ ╩ ╩ ╚═╝
   * Update matching records.
   *
   * > Note that depending on the value of `query.meta.fetch`,
   * > you may be expected to return the array of physical records
   * > that were updated as the second argument to the callback.
   * > (Otherwise, exclude the 2nd argument or send back `undefined`.)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done            Callback
   *               @param {Error?}
   *               @param {Array?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  update: async function (datastoreName, query, done) {

    // Look up the datastore entry (manager/driver/config).
    var dsEntry = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    try {
      const client = dsEntry.manager.writeClient;
      const tableName = query.using;
      const tableSchema = dsEntry.manager.schema[tableName];
      const model = dsEntry.manager.models[tableName];

      const _query = new Query(tableName, tableSchema, model);
      const updateQuery = _query.update(query.criteria, query.valuesToSet);

      /* TODO: See below note and fix so that we do not query the db twice where unnecessary
       * Note: The sqlite driver we're using does not return changed values
       * on an update. If we are expected to fetch, we need to deterministically
       * be able to fetch the exact records that we updated.
       * We cannot simply query off the same criteria because it is possible
       * (nay likely) that one of the criteria is based on a field that is
       * changed in the update call. In most cases, acquiring the primary key
       * value before the update and then re-querying that key after the update
       * will be sufficient. However, it is possible to update the primary key
       * itself. So we will construct 2 cases:
       *  1: Query the primary key for all records that will be updated. Then
       *    craft a new where object based on only those primary keys to
       *    query again after the update executes
       *  2: craft a new where object based on what the primary key is changing
       *    to.
       *
       * Note that option 1 sucks. However, an analysis of the where criteria to
       * determine the optimal *post-update* where criteria is more work than
       * I have time to do, so option 1 it is.
       */

      let newQuery;
      if (query.meta && query.meta.fetch) {
        const pkCol = model.definition[model.primaryKey].columnName;
        let newWhere = {};
        newQuery = _.cloneDeep(query);
        newQuery.criteria = newQuery.criteria || {};

        if (query.valuesToSet[pkCol]) {
          newWhere[pkCol] = query.valuesToSet[pkCol];
        } else {
          newQuery.criteria.select = [pkCol];

          const rows = await wrapAsyncStatements(
            adapter.find.bind(adapter, datastoreName, newQuery));

          delete newQuery.criteria.select;

          const inSet = { in: rows.map(row => row[pkCol]) };
          newWhere[pkCol] = inSet;
        }

        newQuery.criteria.where = newWhere;
      }

      const statement = await wrapAsyncForThis(
        client.run.bind(client, updateQuery.query, updateQuery.values));

      let results;
      if (query.meta && query.meta.fetch) {
        if (statement.changes === 0) {
          results = [];
        } else {
          results = await wrapAsyncStatements(
            adapter.find.bind(adapter, datastoreName, newQuery));
        }
      }

      done(undefined, results);
    } catch (err) {
      done(err);
    }

  },


  /**
   *  ╔╦╗╔═╗╔═╗╔╦╗╦═╗╔═╗╦ ╦
   *   ║║║╣ ╚═╗ ║ ╠╦╝║ ║╚╦╝
   *  ═╩╝╚═╝╚═╝ ╩ ╩╚═╚═╝ ╩
   * Destroy one or more records.
   *
   * > Note that depending on the value of `query.meta.fetch`,
   * > you may be expected to return the array of physical records
   * > that were destroyed as the second argument to the callback.
   * > (Otherwise, exclude the 2nd argument or send back `undefined`.)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done            Callback
   *               @param {Error?}
   *               @param {Array?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  destroy: async function (datastoreName, query, done) {

    // Look up the datastore entry (manager/driver/config).
    var dsEntry = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    try {
      const client = dsEntry.manager.writeClient;
      const tableName = query.using;
      const tableSchema = dsEntry.manager.schema[tableName];
      const model = dsEntry.manager.models[tableName];

      const _query = new Query(tableName, tableSchema, model);
      const queryObj = _query.destroy(query.criteria);

      let results;
      if (query.meta && query.meta.fetch) {
        results = await wrapAsyncStatements(
          adapter.find.bind(adapter, datastoreName, query));
      }

      await wrapAsyncStatements(
        client.run.bind(client, queryObj.query, queryObj.values));

      done(undefined, results);
    } catch (err) {
      done(err);
    }

  },



  //////////////////////////////////////////////////////////////////////////////////////////////////
  //  ██████╗  ██████╗ ██╗                                                                        //
  //  ██╔══██╗██╔═══██╗██║                                                                        //
  //  ██║  ██║██║   ██║██║                                                                        //
  //  ██║  ██║██║▄▄ ██║██║                                                                        //
  //  ██████╔╝╚██████╔╝███████╗                                                                   //
  //  ╚═════╝  ╚══▀▀═╝ ╚══════╝                                                                   //
  // (D)ata (Q)uery (L)anguage                                                                    //
  //                                                                                              //
  // DQL adapter methods:                                                                         //
  // Methods related to fetching information from the database (e.g. finding stored records).     //
  //////////////////////////////////////////////////////////////////////////////////////////////////


  /**
   *  ╔═╗╦╔╗╔╔╦╗
   *  ╠╣ ║║║║ ║║
   *  ╚  ╩╝╚╝═╩╝
   * Find matching records.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done            Callback
   *               @param {Error?}
   *               @param {Array}  [matching physical records]
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  find: async function (datastoreName, query, done) {

    // Look up the datastore entry (manager/driver/config).
    var dsEntry = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    const tableName = query.using;
    const schema = dsEntry.manager.schema[tableName];
    const model = dsEntry.manager.models[tableName];
    const queryObj = new Query(tableName, schema, model);
    const queryStatement = queryObj.find(query.criteria);

    try {
      await spawnReadonlyConnection(dsEntry, async function __FIND__(client) {
        const values = [];
        let resultCount = await wrapAsyncStatements(
          client.each.bind(client, queryStatement.query, queryStatement.values, (err, row) => {
            if (err) throw err;

            values.push(queryObj.castRow(row));
          }));

        done(undefined, values);
      });
    } catch (err) {
      done(err);
    }
  },


  /**
   *   ╦╔═╗╦╔╗╔
   *   ║║ ║║║║║
   *  ╚╝╚═╝╩╝╚╝
   *  ┌─    ┌─┐┌─┐┬─┐  ┌┐┌┌─┐┌┬┐┬┬  ┬┌─┐  ┌─┐┌─┐┌─┐┬ ┬┬  ┌─┐┌┬┐┌─┐    ─┐
   *  │───  ├┤ │ │├┬┘  │││├─┤ │ │└┐┌┘├┤   ├─┘│ │├─┘│ ││  ├─┤ │ ├┤   ───│
   *  └─    └  └─┘┴└─  ┘└┘┴ ┴ ┴ ┴ └┘ └─┘  ┴  └─┘┴  └─┘┴─┘┴ ┴ ┴ └─┘    ─┘
   * Perform a "find" query with one or more native joins.
   *
   * > NOTE: If you don't want to support native joins (or if your database does not
   * > support native joins, e.g. Mongo) remove this method completely!  Without this method,
   * > Waterline will handle `.populate()` using its built-in join polyfill (aka "polypopulate"),
   * > which sends multiple queries to the adapter and joins the results in-memory.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done          Callback
   *               @param {Error?}
   *               @param {Array}  [matching physical records, populated according to the join instructions]
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  /****************************************
   * NOTE: Intention is to support joins.
   * Ignoring for the time being since
   * waterline polyfills a join in memory
   ***************************************/
  // join: function (datastoreName, query, done) {

  //   // Look up the datastore entry (manager/driver/config).
  //   var dsEntry = registeredDatastores[datastoreName];

  //   // Sanity check:
  //   if (_.isUndefined(dsEntry)) {
  //     return done(new Error('Consistency violation: Cannot do that with datastore (`'+datastoreName+'`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
  //   }

  //   // Perform the query and send back a result.
  //   //
  //   // > TODO: Replace this setTimeout with real logic that calls
  //   // > `done()` when finished. (Or remove this method from the
  //   // > adapter altogether
  //   setTimeout(function(){
  //     return done(new Error('Adapter method (`join`) not implemented yet.'));
  //   }, 16);

  // },


  /**
   *  ╔═╗╔═╗╦ ╦╔╗╔╔╦╗
   *  ║  ║ ║║ ║║║║ ║
   *  ╚═╝╚═╝╚═╝╝╚╝ ╩
   * Get the number of matching records.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done          Callback
   *               @param {Error?}
   *               @param {Number}  [the number of matching records]
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  count: async function (datastoreName, query, done) {

    // Look up the datastore entry (manager/driver/config).
    var dsEntry = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    try {
      const tableName = query.using;
      const schema = dsEntry.manager.schema[tableName];
      const model = dsEntry.manager.models[tableName];

      const countQuery = new Query(tableName, schema, model);
      const statement = countQuery.count(query.criteria, 'count_alias');

      await spawnReadonlyConnection(dsEntry, async function __COUNT__(client) {
        const row = await wrapAsyncStatements(
          client.get.bind(client, statement.query, statement.values));

        if (!row) throw new Error('No rows returned by count query?');

        done(undefined, row.count_alias);
      });
    } catch (err) {
      done(err);
    }
  },


  /**
   *  ╔═╗╦ ╦╔╦╗
   *  ╚═╗║ ║║║║
   *  ╚═╝╚═╝╩ ╩
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done          Callback
   *               @param {Error?}
   *               @param {Number}  [the sum]
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  sum: async function (datastoreName, query, done) {

    // Look up the datastore entry (manager/driver/config).
    var dsEntry = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    try {
      const tableName = query.using;
      const schema = dsEntry.manager.schema[tableName];
      const model = dsEntry.manager.models[tableName];

      const sumQuery = new Query(tableName, schema, model);
      const statement = sumQuery.sum(query.criteria, query.numericAttrName, 'sum_alias');

      await spawnReadonlyConnection(dsEntry, async function __SUM__(client) {
        const row = await wrapAsyncStatements(
          client.get.bind(client, statement.query, statement.values));

        if (!row) throw new Error('No rows returned by sum query?');

        done(undefined, row.sum_alias);
      });
    } catch (err) {
      done(err);
    }

  },


  /**
   *  ╔═╗╦  ╦╔═╗
   *  ╠═╣╚╗╔╝║ ╦
   *  ╩ ╩ ╚╝ ╚═╝
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore to perform the query on.
   * @param  {Dictionary}   query         The stage-3 query to perform.
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done          Callback
   *               @param {Error?}
   *               @param {Number}  [the average ("mean")]
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  avg: async function (datastoreName, query, done) {

    // Look up the datastore entry (manager/driver/config).
    var dsEntry = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    try {
      const tableName = query.using;
      const schema = dsEntry.manager.schema[tableName];
      const model = dsEntry.manager.models[tableName];

      const avgQuery = new Query(tableName, schema, model);
      const statement = avgQuery.avg(query.criteria, query.numericAttrName, 'avg_alias');

      await spawnReadonlyConnection(dsEntry, async function __AVG__(client) {
        const row = await wrapAsyncStatements(
          client.get.bind(client, statement.query, statement.values));

        if (!row) throw new Error('No rows returned by avg query?');

        done(undefined, row.avg_alias);
      });
    } catch (err) {
      done(err);
    }

  },



  //////////////////////////////////////////////////////////////////////////////////////////////////
  //  ██████╗ ██████╗ ██╗                                                                         //
  //  ██╔══██╗██╔══██╗██║                                                                         //
  //  ██║  ██║██║  ██║██║                                                                         //
  //  ██║  ██║██║  ██║██║                                                                         //
  //  ██████╔╝██████╔╝███████╗                                                                    //
  //  ╚═════╝ ╚═════╝ ╚══════╝                                                                    //
  // (D)ata (D)efinition (L)anguage                                                               //
  //                                                                                              //
  // DDL adapter methods:                                                                         //
  // Methods related to modifying the underlying structure of physical models in the database.    //
  //////////////////////////////////////////////////////////////////////////////////////////////////

  /* ╔╦╗╔═╗╔═╗╔═╗╦═╗╦╔╗ ╔═╗  ┌┬┐┌─┐┌┐ ┬  ┌─┐
   *  ║║║╣ ╚═╗║  ╠╦╝║╠╩╗║╣    │ ├─┤├┴┐│  ├┤
   * ═╩╝╚═╝╚═╝╚═╝╩╚═╩╚═╝╚═╝   ┴ ┴ ┴└─┘┴─┘└─┘
   * Describe a table and get back a normalized model schema format.
   * (This is used to allow Sails to do auto-migrations)
   */
  describe: async function describe(datastoreName, tableName, cb, meta) {
    var datastore = registeredDatastores[datastoreName];
    spawnReadonlyConnection(datastore, async function __DESCRIBE__(client) {
      // Get a list of all the tables in this database
      // See: http://www.sqlite.org/faq.html#q7)
      var query = `SELECT * FROM sqlite_master WHERE type="table" AND name="${tableName}" ORDER BY name`;

      try {
        const schema = await wrapAsyncStatements(client.get.bind(client, query));
        if (!schema) return Promise.resolve();

        // Query to get information about each table
        // See: http://www.sqlite.org/pragma.html#pragma_table_info
        var columnsQuery = `PRAGMA table_info("${schema.name}")`;

        // Query to get a list of indices for a given table
        var indexListQuery = `PRAGMA index_list("${schema.name}")`;

        schema.indices = [];
        schema.columns = [];

        var index = { columns: [] };

        // Binding to the each method which takes a function that runs for every
        // row returned, then a complete callback function
        await wrapAsyncStatements(client.each.bind(client, indexListQuery, (err, currentIndex) => {
          if (err) throw err;
          // Query to get information about indices
          var indexInfoQuery =
            `PRAGMA index_info("${currentIndex.name}")`;

          // Retrieve detailed information for given index
          client.each(indexInfoQuery, function (err, indexedCol) {
            index.columns.push(indexedCol);
          });

          schema.indices.push(currentIndex);
        }));

        await wrapAsyncStatements(client.each.bind(client, columnsQuery, (err, column) => {
          if (err) throw err;

          // In SQLite3, AUTOINCREMENT only applies to PK columns of
          // INTEGER type
          column.autoIncrement = (column.type.toLowerCase() == 'integer'
            && column.pk == 1);

          // By default, assume column is not indexed until we find that it
          // is
          column.indexed = false;

          // Search for indexed columns
          schema.indices.forEach(function (idx) {
            if (!column.indexed) {
              index.columns.forEach(function (indexedCol) {
                if (indexedCol.name == column.name) {
                  column.indexed = true;
                  if (idx.unique) column.unique = true;
                }
              });
            }
          });

          schema.columns.push(column);
        }));

        var normalizedSchema = utils.normalizeSchema(schema);
        // Set internal schema mapping
        datastore.manager.schema[tableName] = normalizedSchema;

        return Promise.resolve(normalizedSchema);
      } catch (err) {
        return Promise.reject(err);
      }
    })
      .then(schema => cb(undefined, schema))
      .catch(err => cb(err));
  },

  /**
   *  ╔╦╗╔═╗╔═╗╦╔╗╔╔═╗
   *   ║║║╣ ╠╣ ║║║║║╣
   *  ═╩╝╚═╝╚  ╩╝╚╝╚═╝
   * Build a new physical model (e.g. table/etc) to use for storing records in the database.
   *
   * (This is used for schema migrations.)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore containing the table to define.
   * @param  {String}       tableName     The name of the table to define.
   * @param  {Dictionary}   definition    The physical model definition (not a normal Sails/Waterline model-- log this for details.)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done           Callback
   *               @param {Error?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  define: async function (datastoreName, tableName, definition, done) {

    // Look up the datastore entry (manager/driver/config).
    var datastore = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(datastore)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    let tableQuery;
    let outerSchema
    try {
      const client = datastore.manager.writeClient;
      const escapedTable = utils.escapeTable(tableName);

      // Iterate through each attribute, building a query string
      const _schema = utils.buildSchema(definition, datastore.manager.foreignKeys[tableName]);
      outerSchema = _schema.schema;

      // Check for any index attributes
      const indices = utils.buildIndexes(definition);

      // Build query
      // const query = 'CREATE TABLE ' + escapedTable + ' (' + _schema.declaration + ')';
      tableQuery = 'CREATE TABLE ' + escapedTable + ' (' + _schema.declaration + ')';

      // await wrapAsyncStatements(client.run.bind(client, query));
      await wrapAsyncStatements(client.run.bind(client, tableQuery));

      await Promise.all(indices.map(async index => {
        // Build a query to create a namespaced index tableName_key
        const indexQuery = 'CREATE INDEX ' + tableName + '_' + index + ' on ' +
          tableName + ' (' + index + ');';

        await wrapAsyncStatements(client.run.bind(client, indexQuery));
      }));

      // Replacing if it already existed
      datastore.manager.schema[tableName] = _schema.schema;

      done();
    } catch (err) {
      done(err);
    }

  },


  /**
   *  ╔╦╗╦═╗╔═╗╔═╗
   *   ║║╠╦╝║ ║╠═╝
   *  ═╩╝╩╚═╚═╝╩
   * Drop a physical model (table/etc.) from the database, including all of its records.
   *
   * (This is used for schema migrations.)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName The name of the datastore containing the table to drop.
   * @param  {String}       tableName     The name of the table to drop.
   * @param  {Ref}          unused        Currently unused (do not use this argument.)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done          Callback
   *               @param {Error?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  drop: async function (datastoreName, tableName, unused, done) {

    // Look up the datastore entry (manager/driver/config).
    var dsEntry = registeredDatastores[datastoreName];

    // Sanity check:
    if (_.isUndefined(dsEntry)) {
      return done(new Error('Consistency violation: Cannot do that with datastore (`' + datastoreName + '`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
    }

    // Build query
    const query = 'DROP TABLE IF EXISTS ' + utils.escapeTable(tableName);


    try {
      const client = dsEntry.manager.writeClient;
      await wrapAsyncStatements(client.run.bind(client, query));

      delete dsEntry.manager.schema[tableName];
      done();
    } catch (err) {
      done(err);
    }

  },


  /**
   *  ╔═╗╔═╗╔╦╗  ┌─┐┌─┐┌─┐ ┬ ┬┌─┐┌┐┌┌─┐┌─┐
   *  ╚═╗║╣  ║   └─┐├┤ │─┼┐│ │├┤ ││││  ├┤
   *  ╚═╝╚═╝ ╩   └─┘└─┘└─┘└└─┘└─┘┘└┘└─┘└─┘
   * Set a sequence in a physical model (specifically, the auto-incrementing
   * counter for the primary key) to the specified value.
   *
   * (This is used for schema migrations.)
   *
   * > NOTE - removing method. SQLite can support setting a sequence on
   * > primary key fields (or other autoincrement fields), however the
   * > need is slim and I don't have time.
   * > Leaving shell here for future developers if necessary
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {String}       datastoreName   The name of the datastore containing the table/etc.
   * @param  {String}       sequenceName    The name of the sequence to update.
   * @param  {Number}       sequenceValue   The new value for the sequence (e.g. 1)
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   * @param  {Function}     done
   *               @param {Error?}
   * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
   */
  // setSequence: function (datastoreName, sequenceName, sequenceValue, done) {

  //   // Look up the datastore entry (manager/driver/config).
  //   var dsEntry = registeredDatastores[datastoreName];

  //   // Sanity check:
  //   if (_.isUndefined(dsEntry)) {
  //     return done(new Error('Consistency violation: Cannot do that with datastore (`'+datastoreName+'`) because no matching datastore entry is registered in this adapter!  This is usually due to a race condition (e.g. a lifecycle callback still running after the ORM has been torn down), or it could be due to a bug in this adapter.  (If you get stumped, reach out at https://sailsjs.com/support.)'));
  //   }

  //   // Update the sequence.
  //   //
  //   // > TODO: Replace this setTimeout with real logic that calls
  //   // > `done()` when finished. (Or remove this method from the
  //   // > adapter altogether
  //   setTimeout(function(){
  //     return done(new Error('Adapter method (`setSequence`) not implemented yet.'));
  //   }, 16);

  // },
};

/**
 * Spawns temporary connection and executes given logic. Returns promise for
 * use with async/await
 * @param {*} datastore
 * @param {Function} logic Takes the client as its only argument. Can return a
 * value or a Promise
 * @param {*} cb
 * @return Promise
 */
function spawnReadonlyConnection(datastore, logic) {
  let client;
  return new Promise((resolve, reject) => {
    if (!datastore) reject(Errors.InvalidConnection);

    var datastoreConfig = datastore.config;

    // Check if we want to run in verbose mode
    // Note that once you go verbose, you can't go back.
    // See: https://github.com/mapbox/node-sqlite3/wiki/API
    if (datastoreConfig.verbose) sqlite3.verbose();

    // Make note whether the database already exists
    exists = fs.existsSync(datastoreConfig.filename);

    // Create a new handle to our database
    client = new sqlite3.Database(
      datastoreConfig.filename,
      sqlite3.OPEN_READONLY,
      err => {
        if (err) reject(err);
        else resolve(client);
      }
    );
  })
    .then(logic)
    .catch(err => {
      return Promise.reject(err); //we want the user process to get this error as well
    })
    .finally(() => {
      if (client) client.close();
    });
}

/**
 * Simple utility function that wraps an async function in a promise
 * @param {Function} func Async function which takes 1 argument: a callback
 * function that takes err, value as args (in that order)
 * @return Promise
 */
function wrapAsyncStatements(func) {
  return new Promise((resolve, reject) => {
    func((err, value) => {
      if (err) reject(err);
      else resolve(value);
    });
  });
}

/**
 * Utility function that wraps an async function in a promise. In contrast
 * to the above, this method specifically resolves with the `this` value
 * passed to the callback function
 * @param {Function} func Async function which takes 1 argument: a callback
 * function that takes an err and invokes its callback with a `this` property
 */
function wrapAsyncForThis(func) {
  return new Promise((resolve, reject) => {
    func(function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  })
}

module.exports = adapter;