// Database
export type Collections = {
	users: import("./database/users").DBUser,
	messages: import("./database/messages").DBMessage,
	ipBans: { ip: string },
	servers: { privateKey: string },
};

type Projection<Type> = {
	[Key in keyof Type]?: 1;
};

type Sort<Type> = {
	[Key in keyof Type]?: 1 | -1;
};

type Update<Type> = {
	[$inc | $pull | $addToSet]?: {
		[Key in keyof Type]?: Type[Key] extends number ? number : never;
	};
};

type Index<Type> = {
	[Key in keyof Type]?: 1 | -1 | "hashed";
};

type Colors<Styles> = {
	[Key in keyof Styles]: (string: string) => {};
};

declare function insertOne<collection extends string & keyof Collections>(collection: collection, document: Collections[collection]): Promise<void>;
declare function insertMany<collection extends string & keyof Collections>(collection: collection, documents: Collections[collection][]): Promise<void>;
declare function collectionLength<collection extends string & keyof Collections>(collection: collection): Promise<number>;
declare function findOne<collection extends string & keyof Collections>(collection: collection, filter: Partial<Collections[collection]>, withDocumentID?: boolean, customProjection?: Projection<Collections[collection]>): Promise<Collections[collection]?>;
declare function findMany<collection extends string & keyof Collections>(collection: collection, filter?: Partial<Collections[collection]>, sort?: Sort<Collections[collection]>, limit?: number | undefined, skip?: number, withDocumentID?: boolean, customProjection?: Projection<Collections[collection]>): Promise<Collections[collection][]>;
declare function updateOne<collection extends string & keyof Collections>(collection: collection, filter: Partial<Collections[collection]>, changes: Partial<Collections[collection]>, options?: import("mongodb").UpdateOptions, customUpdate?: Update<Collections[collection]>): Promise<void>;
declare function updateMany<collection extends string & keyof Collections>(collection: collection, filter: Partial<Collections[collection]>, changes: Partial<Collections[collection]>, options?: import("mongodb").UpdateOptions, customUpdate?: Update<Collections[collection]>): Promise<void>;
declare function removeOne<collection extends string & keyof Collections>(collection: collection, filter: Partial<Collections[collection]>): Promise<void>;
declare function removeMany<collection extends string & keyof Collections>(collection: collection, filter?: Partial<Collections[collection]>): Promise<void>;
declare function createIndex<collection extends string & keyof Collections>(collection: collection, index: Index<Collections[collection]>): Promise<void>;

// Frontend
declare function getElementById<elType extends string & keyof HTMLElementTagNameMap, elNull extends boolean>(id: string, type: elType, isNullable: elNull): HTMLElementTagNameMap[elType] | (elNull extends true ? null : never);

// Endpoints
type RequestMethod = 'GET' | 'POST' | 'HEAD' | 'PUT' | 'DELETE' | 'OPTIONS' | 'PATCH';
type RequestAuth = 'user' | 'admin' | 'sudo';
type RequestUser = import('./database/users').DBUser & { sudomode: boolean };
type RequestRequirements = { ratelimits?: { ids: string[], type?: 'id' | 'ip' } };
type RequestHandler<T, T2> = (request: { body: T } & RequestData & T2) => Promise<ResponseData | undefined | void>;
type RequestData = {
	method: RequestMethod,
	path: string,
	body: {},
	urlParameters: string[],
	parameters: import("url").URLSearchParams,
	headers: import("http").IncomingHttpHeaders,
	cookies: Record<string, string>,
	user: RequestUser?,
	ip: string,
};

type ResponseData = Partial<{
	status: number,
	headers: Record<string, string>,
	body: any,
	file: string,
}>;

declare function addEndpoint<body extends object, auth extends RequestAuth | undefined>(method: RequestMethod, path: string, handler: RequestHandler<body, undefined extends auth ? {} : { user: RequestUser }>, requirements?: { body?: body, auth?: auth } & RequestRequirements): void;
