import * as _ from 'lodash';

import { Actions } from '@ngrx/effects';

import {
  Direction,
  Document,
  FilteringOperator,
  FilteringParam,
  NgrxJsonApiFilteringConfig,
  NgrxJsonApiStore,
  NgrxJsonApiStoreData,
  NgrxJsonApiStoreResources,
  NgrxJsonApiStoreQueries,
  OperationType,
  QueryParams,
  ResourceRelationDefinition,
  Resource,
  ResourceDefinition,
  ResourceIdentifier,
  ResourceQuery,
  ResourceQueryStore,
  ResourceStore,
  ResourceState,
  SortingParam,
} from './interfaces';

export const denormaliseObject = (
  resource: Resource,
  storeData: NgrxJsonApiStoreData,
  bag: NgrxJsonApiStoreData,
  isRSdenorm: boolean,
): any => {
  // this function MUST MUTATE resource
  let denormalised = resource;

  if (resource.hasOwnProperty('relationships')) {

    Object.keys(resource.relationships)
      .forEach(relation => {
        resource.relationships[relation]['reference'] = {};
        let data: ResourceIdentifier | Array<ResourceIdentifier> = resource.relationships[relation].data;
        // denormalised relation
        let relationDenorm;

        if (data === null || _.isEqual(data, [])) {

          relationDenorm = data;

        } else if (_.isPlainObject(data)) {
          // hasOne relation
          let relatedRS: Resource | ResourceStore = getSingleResourceStore(
            <ResourceIdentifier>data, storeData);
          relatedRS = isRSdenorm ? relatedRS : relatedRS.resource;
          relationDenorm = denormaliseResource(
            relatedRS, storeData, bag);
        } else if (_.isArray(data)) {
          // hasMany relation
          let relatedRSs: Array<ResourceStore> = getMultipleResourceStore(data, storeData);
          relationDenorm = relatedRSs
            .map(r => isRSdenorm ? r : r.resource)
            .map(r => denormaliseResource(r, storeData, bag));
        }
        let relationDenormPath = 'relationships.' + relation + '.reference';
        denormalised = <Resource>_.set(
          denormalised,
          relationDenormPath,
          relationDenorm
        );
      });
  }

  return denormalised;
};

export const denormaliseResource = (
  item: ResourceStore | Resource,
  storeData: NgrxJsonApiStoreData,
  bag: any = {}): any => {

  if (!item) {
    return null;
  }
  let isResourceStore = item.hasOwnProperty('resource');
  let resourceStore;
  let resource: Resource;
  if (isResourceStore) {
    resourceStore = _.cloneDeep(<ResourceStore>item);
    resource = resourceStore.resource;
  } else {
    resource = _.cloneDeep(<Resource>item);
  }

  if (_.isUndefined(bag[resource.type])) {
    bag[resource.type] = {};
  }
  if (_.isUndefined(bag[resource.type][resource.id])) {

    if (isResourceStore) {
      bag[resource.type][resource.id] = resourceStore;
      resourceStore.resource = denormaliseObject(
        resourceStore.resource,
        storeData,
        bag,
        isResourceStore);
      resourceStore.persistedResource = denormaliseObject(
        resourceStore.persistedResource,
        storeData,
        bag,
        isResourceStore);
    } else {
      bag[resource.type][resource.id] = resource;
      resource = denormaliseObject(
        resource,
        storeData,
        bag,
        isResourceStore);
    }
  }

  return bag[resource.type][resource.id];

};

export const getSingleResourceStore = (
  resourceId: ResourceIdentifier,
  storeData: NgrxJsonApiStoreData): ResourceStore => {
  return _.get(storeData, [resourceId.type, resourceId.id], null);
};

export const getMultipleResourceStore = (
  resourceIds: Array<ResourceIdentifier>,
  resources: NgrxJsonApiStoreData): Array<ResourceStore> => {
  return resourceIds.map(id => getSingleResourceStore(id, resources));
};

export const getSingleTypeResources = (
  query: ResourceQuery,
  resources: NgrxJsonApiStoreData): NgrxJsonApiStoreResources => {
  return resources[query.type];
};

export const transformStoreResources = (
  resources: NgrxJsonApiStoreResources): Array<Resource> => {

  return <Array<Resource>>_.flatMap(resources);
};

export const transformStoreData = (
  resources: NgrxJsonApiStoreData): Array<Resource> => {

  return Object.keys(resources).reduce((result, key) => {
    return [...result, ...transformStoreResources(getSingleTypeResources(
      { type: key }, resources))];
  }, []);

};

export const deleteStoreResources = (state: NgrxJsonApiStoreData, query: ResourceQuery) => {
  let newState = Object.assign({}, state);
  // if an id is not provided, all resources of the provided type will be deleted
  if (typeof query.id === 'undefined') {
    newState[query.type] = {};
  } else {
    delete newState[query.type][query.id];
  }
  return newState;
};

export const updateResourceObject = (original: Resource,
  source: Resource): Resource => {

  return _.merge({}, original, source);

};

export const insertStoreResource = (state: NgrxJsonApiStoreResources,
  resource: Resource, fromServer: boolean): NgrxJsonApiStoreResources => {

  let newState = Object.assign({}, state);
  if (fromServer) {
    newState[resource.id] = {
      resource: resource,
      persistedResource: resource,
      state: ResourceState.IN_SYNC,
      errors: [],
      loading: false
    };
  } else {
    newState[resource.id] = {
      resource: resource,
      persistedResource: null,
      state: ResourceState.CREATED,
      errors: [],
      loading: false
    };
  }
  return _.isEqual(state, newState) ? state : newState;
};

export const updateStoreResource = (state: NgrxJsonApiStoreResources,
  resource: Resource, fromServer: boolean): NgrxJsonApiStoreResources => {

  let foundResource = state[resource.id].resource;
  let persistedResource = state[resource.id].persistedResource;

  let newResource: Resource;
  let newResourceState: ResourceState;
  if (fromServer) {
    // form server, override everything
    // TODO need to handle check and keep local updates?
    newResource = resource;
    persistedResource = resource;
    newResourceState = ResourceState.IN_SYNC;
  } else {
    let mergedResource = updateResourceObject(foundResource, resource);
    if (_.isEqual(mergedResource, persistedResource)) {
      // no changes anymore, do nothing
      newResource = persistedResource;
      newResourceState = ResourceState.IN_SYNC;
    } else {
      // merge changes and mark as CREATED or UPDATED depending on whether
      // an original version is available
      newResource = mergedResource;
      newResourceState = persistedResource === null ? ResourceState.CREATED : ResourceState.UPDATED;
    }
  }

  let newState = Object.assign({}, state);
  newState[resource.id] = {
    resource: newResource,
    persistedResource: persistedResource,
    state: newResourceState,
    errors: [],
    loading: false
  };

  return _.isEqual(newState[resource.id], state[resource.id]) ? state : newState;
};


export const updateQueryErrors = (
  state: NgrxJsonApiStoreQueries,
  queryId: string,
  document: Document): NgrxJsonApiStoreQueries => {

  if (!queryId || !state[queryId]) {
    return state;
  }
  let newState = Object.assign({}, state);
  let newStoreQuery = Object.assign({}, newState[queryId]);
  newStoreQuery.errors = [];
  if (document.errors) {
    newStoreQuery.errors.push(...document.errors);
  }
  newState[queryId] = newStoreQuery;
  return newState;
};

export const updateResourceErrors = (
  state: NgrxJsonApiStoreData,
  query: ResourceQuery,
  document: Document): NgrxJsonApiStoreData => {
  if (!query.type || !query.id || document.data instanceof Array) {
    // TODO: Why does document.data has to be an Array?
    throw new Error('invalid parameters');
  }
  if (!state[query.type] || !state[query.type][query.id]) {
    // resource is not locally stored, no need to update(?)
    return state;
  }
  let newState: NgrxJsonApiStoreData = Object.assign({}, state);
  newState[query.type] = Object.assign({}, newState[query.type]);
  let storeResource = Object.assign({}, newState[query.type][query.id]);
  storeResource.errors = [];
  if (document.errors) {
    storeResource.errors.push(...document.errors);
  }
  newState[query.type][query.id] = storeResource;
  return newState;
};

export const rollbackStoreResources = (state: NgrxJsonApiStoreData): NgrxJsonApiStoreData => {
  let newState: NgrxJsonApiStoreData = Object.assign({}, state);
  Object.keys(newState).forEach(type => {
    newState[type] = Object.assign({}, newState[type]);
    Object.keys(newState[type]).forEach(id => {
      let storeResource = newState[type][id];
      if (!storeResource.persistedResource) {
        delete newState[type][id];
      } else if (storeResource.state !== ResourceState.IN_SYNC) {
        newState[type][id] = Object.assign({}, newState[type][id], {
          state: ResourceState.IN_SYNC,
          resource: newState[type][id].persistedResource
        });
      }
    });
  });
  return newState;
};

export const updateOrInsertResource = (state: NgrxJsonApiStoreData,
  resource: Resource, fromServer: boolean, override: boolean): NgrxJsonApiStoreData => {

  // handle relationships first.
  // FIXME this is not working, the data section of a relationship contains only <type, id>, not a complete resource
  // if (resource.hasOwnProperty('relationships')) {
  //    Object.keys(resource.relationships)
  //       .forEach(relation => {
  //           let data = resource.relationships[relation].data;
  //           if (_.isPlainObject(data)) {
  //               // hasOne relation
  //               newState = updateOrInsertResource(state, data, resourceState);
  //           } else if (_.isArray(data)) {
  //                // hasMany relation
  //                newState = <NgrxJsonApiStoreData>data.reduce(
  //                    (partialState: NgrxJsonApiStoreData, currentResource: Resource): NgrxJsonApiStoreData => {
  //                        return updateOrInsertResource(partialState, currentResource, resourceState);
  //                    }, newState);
  //            }
  //        });
  // }

  if (_.isUndefined(state[resource.type])) {
    // we must mutate the main state (ngrxjsonapistoredata)
    let newState: NgrxJsonApiStoreData = Object.assign({}, state);
    newState[resource.type] = {};
    newState[resource.type] = insertStoreResource(newState[resource.type], resource, fromServer);
    return newState;
  } else if (_.isUndefined(state[resource.type][resource.id]) || override) {
    let updatedTypeState = insertStoreResource(state[resource.type], resource, fromServer);
    if (updatedTypeState !== state[resource.type]) {
      let newState: NgrxJsonApiStoreData = Object.assign({}, state);
      newState[resource.type] = updatedTypeState;
      return newState;
    }
    return state;
  } else {
    let updatedTypeState = updateStoreResource(state[resource.type], resource, fromServer);
    if (updatedTypeState !== state[resource.type]) {
      let newState: NgrxJsonApiStoreData = Object.assign({}, state);
      newState[resource.type] = updatedTypeState;
      return newState;
    }
    return state;
  }

};

/**
 * Updates the state of a resource in the store.
 *
 * @param state
 * @param resourceId
 * @param resourceState
 * @param loading
 * @returns {NgrxJsonApiStoreData}
 */
export const updateResourceState = (state: NgrxJsonApiStoreData,
  resourceId: ResourceIdentifier, resourceState?: ResourceState, loading?: OperationType): NgrxJsonApiStoreData => {
  if (_.isUndefined(state[resourceId.type]) || _.isUndefined(state[resourceId.type][resourceId.id])) {
    return state;
  }
  let newState: NgrxJsonApiStoreData = Object.assign({}, state);
  newState[resourceId.type] = Object.assign({}, newState[resourceId.type]);
  newState[resourceId.type][resourceId.id] = Object.assign({}, newState[resourceId.type][resourceId.id]);
  if (resourceState !== null) {
    newState[resourceId.type][resourceId.id].state = resourceState;
  }
  if (loading != null) {
    newState[resourceId.type][resourceId.id].loading = loading;
  }
  return newState;
};

// export const cloneQueryParams = (queryParams: QueryParams): QueryParams => {
//     let newQueryParams : QueryParams = {};
//     if(queryParams.include){
//         newQueryParams.include = queryParams.include.slice(0);
//     }
//     if(queryParams.fields){
//       newQueryParams.fields = queryParams.fields.slice(0);
//     }
//     if(queryParams.filtering){
//       newQueryParams.filtering = queryParams.filtering.map(it => Object.assign({}, it));
//     }
//     if(queryParams.sorting){
//       newQueryParams.sorting = queryParams.sorting.map(it => Object.assign({}, it));
//     }
//     return newQueryParams;
// }
//
// export const cloneResourceQuery = (query: ResourceQuery): ResourceQuery => {
//     let newQuery = Object.assign({}, query);
//     if(newQuery.params){
//         newQuery.params = cloneQueryParams(newQuery.params);
//     }
//     return newQuery;
// }

/**
 * Updates the query information for the given query in the store.
 */
export const updateQueryParams = (state: NgrxJsonApiStoreQueries,
  query: ResourceQuery): NgrxJsonApiStoreQueries => {

  let newStoreQuery = Object.assign({}, state[query.queryId]);
  newStoreQuery.loading = true;
  newStoreQuery.query = _.cloneDeep(query);

  if (!query.queryId) {
    let queryId = uuid();
    newStoreQuery.query.queryId = queryId;
  }

  if (_.isUndefined(newStoreQuery.errors)) {
    newStoreQuery.errors = [];
  }

  let newState: NgrxJsonApiStoreQueries = Object.assign({}, state);
  newState[newStoreQuery.query.queryId] = newStoreQuery;
  return newState;
};

/**
 * Removes the given query from the store.
 */
export const removeQuery = (state: NgrxJsonApiStoreQueries,
  queryId: string): NgrxJsonApiStoreQueries => {
  let newState: NgrxJsonApiStoreQueries = Object.assign({}, state);
  delete newState[queryId];
  return newState;
};

export const toResourceIdentifier = (resource: Resource): ResourceIdentifier => {
  return { type: resource.type, id: resource.id };
};


/**
 * Updates the query results for the given query in the store.
 */
export const updateQueryResults = (state: NgrxJsonApiStoreQueries, queryId: string,
  document: Document): NgrxJsonApiStoreQueries => {

  let storeQuery: ResourceQueryStore = state[queryId];
  if (storeQuery) {
    let data = _.isArray(document.data) ? document.data : [document.data];
    let newQueryStore = Object.assign({}, storeQuery, {
      resultIds: data.map(it => toResourceIdentifier(it)),
      loading: false
    });

    let newState: NgrxJsonApiStoreQueries = Object.assign({}, state);
    newState[queryId] = newQueryStore;
    return newState;
  }
  return state;
};


export const updateStoreResources = (state: NgrxJsonApiStoreData,
  payload: Document): NgrxJsonApiStoreData => {
  // perhaps this should be named updateStoreData
  let data = <Array<Resource> | Resource>_.get(payload, 'data');

  if (_.isUndefined(data)) {
    return state;
  }

  data = _.isArray(data) ? data : [data];

  let included = <Array<Resource>>_.get(payload, 'included');

  if (!_.isUndefined(included)) {
    data = [...data, ...included];
  }

  return <NgrxJsonApiStoreData>_.reduce(
    data, (result: NgrxJsonApiStoreData,
      resource: Resource) => {
      // let resourcePath: string = getResourcePath(
      //   result.resourcesDefinitions, resource.type);
      // Extremely ugly, needs refactoring!
      // let newPartialState = { data: {} };
      // newPartialState.data[resourcePath] = { data: {} } ;
      // newPartialState.data = updateOrInsertResource(
      // result.data, resource);
      return updateOrInsertResource(result, resource, true, true);
      // result.data[resourcePath].data = updateOrInsertResource(
      // result.data[resourcePath].data, resource);
      // return <NgrxJsonApiStore>_.merge({}, result, newPartialState);
    }, state);
};

export const filterResources = (
  resources: NgrxJsonApiStoreResources,
  storeData: NgrxJsonApiStoreData,
  query: ResourceQuery,
  resourceDefinitions: Array<ResourceDefinition>,
  filteringConfig?: NgrxJsonApiFilteringConfig) => {
  return _.filter(resources, (resource) => {
    if (query.hasOwnProperty('params') && query.params.hasOwnProperty('filtering')) {
      return query.params.filtering.every(element => {
        let pathSeparator;
        let filteringOperators;

        if (!_.isUndefined(filteringConfig)) {
          pathSeparator = <string>_.get(filteringConfig, 'pathSeparator');
          filteringOperators = <Array<FilteringOperator>>_.get(filteringConfig, 'filteringOperators');
        }
        // resource type and attribute
        let resourceFieldValue = getResourceFieldValueFromPath(
          element.path,
          resource,
          storeData,
          resourceDefinitions,
          pathSeparator
        );
        if (!resourceFieldValue) {
          return false;
        }

        let operator = <FilteringOperator>_.find(filteringOperators, { name: element.operator });

        if (operator) {
          return operator.comparison(element.value, resourceFieldValue);
        }

        element.operator = element.hasOwnProperty('operator') ? element.operator : 'iexact';

        switch (element.operator) {
          case 'iexact':
            if (_.isString(element.value) && _.isString(resourceFieldValue)) {
              return element.value.toLowerCase() === resourceFieldValue.toLowerCase();
            } else {
              return element.value === resourceFieldValue;
            }

          case 'exact':
            return element.value === resourceFieldValue;

          case 'contains':
            return _.includes(resourceFieldValue, element.value);

          case 'icontains':
            return _.includes(resourceFieldValue.toLowerCase(),
              element.value.toLowerCase());

          case 'in':
            if (_.isArray(element.value)) {
              return _.includes(element.value, resourceFieldValue);
            } else {
              return _.includes([element.value], resourceFieldValue);
            }
          case 'gt':
            return element.value > resourceFieldValue;

          case 'gte':
            return element.value >= resourceFieldValue;

          case 'lt':
            return element.value < resourceFieldValue;

          case 'lte':
            return element.value <= resourceFieldValue;

          case 'startswith':
            return _.startsWith(resourceFieldValue, element.value);

          case 'istartswith':
            return _.startsWith(resourceFieldValue.toLowerCase(),
              element.value.toLowerCase());

          case 'endswith':
            return _.endsWith(resourceFieldValue, element.value);

          case 'iendswith':
            return _.endsWith(resourceFieldValue.toLowerCase(),
              element.value.toLowerCase());

          default:
            return true;
        }
      });
    } else {
      return true;
    }
  });
};

/**
 * Get the value for the last field in a given fitering path.
 *
 * @param path
 * @param baseResourceStore
 * @param storeData
 * @param resourceDefinitions
 * @param pathSepartor
 * @returns the value of the last field in the path.
 */
export const getResourceFieldValueFromPath = (
  path: string,
  baseResourceStore: ResourceStore,
  storeData: NgrxJsonApiStoreData,
  resourceDefinitions: Array<ResourceDefinition>,
  pathSeparator?: string
) => {
  if (_.isUndefined(pathSeparator)) {
    pathSeparator = '.';
  }
  let fields: Array<string> = path.split(pathSeparator);
  let currentResourceStore = baseResourceStore;
  for (let i = 0; i < fields.length; i++) {
    let definition = _.find(resourceDefinitions, { type: currentResourceStore.resource.type });

    if (_.isUndefined(definition)) {
      throw new Error('Definition not found');
    }
    // if both attributes and relationships are missing, raise an error
    if (_.isUndefined(definition.attributes) && _.isUndefined(definition.relationships)) {
      throw new Error('Attributes or Relationships must be provided');
    }
    if (definition.attributes.hasOwnProperty(fields[i])) {
      return _.get(currentResourceStore, 'resource.attributes.' + fields[i], null);
    } else if (definition.relationships.hasOwnProperty(fields[i])) {
      if (i === (fields.length - 1)) {
        throw new Error('The last field in the filtering path cannot be a relation');
      }
      let resourceRelation = definition.relationships[fields[i]];
      if (resourceRelation.relationType === 'hasMany') {
        throw new Error('Cannot filter past a hasMany relation');
      } else {
        let relation = _.get(currentResourceStore, 'resource.relationships.' + fields[i], null);
        if (!relation || !relation.data) {
          return null;
        } else {
          let relatedPath = [
            resourceRelation.type,
            relation.data.id
          ];
          currentResourceStore = <ResourceStore>_.get(storeData, relatedPath);
        }
      }
    } else {
      throw new Error('Cannot find field in attributes or relationships');
    }
    if (_.isUndefined(currentResourceStore)) {
      return null;
    }
  }
};

/**
*
* Copied as it is from @ngrx/example-app
* I'm sure the guys at @ngrx won't mind :>
*
*/
/**
 * This function coerces a string into a string literal type.
 * Using tagged union types in TypeScript 2.0, this enables
 * powerful typechecking of our reducers.
 *
 * Since every action label passes through this function it
 * is a good place to ensure all of our action labels
 * are unique.
 */

let typeCache: { [label: string]: boolean } = {};
export function type<T>(label: T | ''): T {
  if (typeCache[<string>label]) {
    throw new Error(`Action type '${label}' is not unqiue'`);
  }

  typeCache[<string>label] = true;

  return <T>label;
}

export const generateIncludedQueryParams = (included: Array<string>): string => {
  if (_.isEmpty(included)) {
    return '';
  }

  return 'include=' + included.join();

};

export const generateFieldsQueryParams = (fields: Array<string>): string => {
  if (_.isEmpty(fields)) {
    return '';
  }

  return 'fields=' + fields.join();

};

export const generateFilteringQueryParams = (filtering: Array<FilteringParam>): string => {
  if (_.isEmpty(filtering)) {
    return '';
  }
  let filteringParams = filtering
    .map(f => {
      return 'filter[' + f.path + ']' +
        (f.operator ? '[' + f.operator + ']' : '') +
        '=' + encodeURIComponent(f.value);
    });
  return filteringParams.join('&');
};

export const generateSortingQueryParams = (sorting: Array<SortingParam>): string => {
  if (_.isEmpty(sorting)) {
    return '';
  }
  return 'sort=' + sorting.map(f => (f.direction === Direction.ASC ? '' : '-') + f.api).join(',');

};

export const generateQueryParams = (...params: Array<string>) => {
  let newParams = params.filter(p => p !== '');
  if (newParams.length !== 0) {
    return '?' + newParams.join('&');
  } else {
    return '';
  }
};

/* tslint:disable */
export const uuid = () => {
  let lut = []; for (let i=0; i<256; i++) { lut[i] = (i<16?'0':'')+(i).toString(16); }
  let d0 = Math.random()*0xffffffff|0;
  let d1 = Math.random()*0xffffffff|0;
  let d2 = Math.random()*0xffffffff|0;
  let d3 = Math.random()*0xffffffff|0;
  return lut[d0&0xff]+lut[d0>>8&0xff]+lut[d0>>16&0xff]+lut[d0>>24&0xff]+'-'+
  lut[d1&0xff]+lut[d1>>8&0xff]+'-'+lut[d1>>16&0x0f|0x40]+lut[d1>>24&0xff]+'-'+
  lut[d2&0x3f|0x80]+lut[d2>>8&0xff]+'-'+lut[d2>>16&0xff]+lut[d2>>24&0xff]+
  lut[d3&0xff]+lut[d3>>8&0xff]+lut[d3>>16&0xff]+lut[d3>>24&0xff];
};
/* tslint:enable */
