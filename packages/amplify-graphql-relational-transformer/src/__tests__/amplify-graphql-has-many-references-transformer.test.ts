import { IndexTransformer, PrimaryKeyTransformer } from '@aws-amplify/graphql-index-transformer';
import { ModelTransformer } from '@aws-amplify/graphql-model-transformer';
import { ConflictHandlerType, DDB_DEFAULT_DATASOURCE_STRATEGY, validateModelSchema } from '@aws-amplify/graphql-transformer-core';
import { Kind, parse } from 'graphql';
import { mockSqlDataSourceStrategy, testTransform } from '@aws-amplify/graphql-transformer-test-utils';
import { BelongsToTransformer, HasManyTransformer, HasOneTransformer } from '..';

test('has many query', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member] @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: ID!
      team: Team @belongsTo(references: ["teamID"])
    }
  `;

  const out = testTransform({
    schema: inputSchema,
    transformers: [new ModelTransformer(), new PrimaryKeyTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
  });

  expect(out).toBeDefined();
  const schema = parse(out.schema);
  validateModelSchema(schema);
  expect(out.schema).toMatchSnapshot();
  expect((out.stacks as any).ConnectionStack.Resources.TeammembersResolver).toBeTruthy();

  const testObjType = schema.definitions.find((def: any) => def.name && def.name.value === 'Team') as any;
  expect(testObjType).toBeDefined();

  const relatedField = testObjType.fields.find((f: any) => f.name.value === 'members');
  expect(relatedField).toBeDefined();
  expect((relatedField.type as any).name.value).toEqual('ModelMemberConnection');
  expect(relatedField.type.kind).toEqual(Kind.NAMED_TYPE);
  expect(relatedField.arguments.length).toEqual(4);
  expect(relatedField.arguments.find((f: any) => f.name.value === 'filter')).toBeDefined();
  expect(relatedField.arguments.find((f: any) => f.name.value === 'limit')).toBeDefined();
  expect(relatedField.arguments.find((f: any) => f.name.value === 'nextToken')).toBeDefined();
  expect(relatedField.arguments.find((f: any) => f.name.value === 'sortDirection')).toBeDefined();

  expect(out.resolvers['Team.members.req.vtl']).toBeDefined();
  expect(out.resolvers['Team.members.req.vtl']).toMatchSnapshot();
  expect(out.resolvers['Member.team.req.vtl']).toBeDefined();
  expect(out.resolvers['Member.team.req.vtl']).toMatchSnapshot();
});

test('fails if indexName is provided with references', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member] @hasMany(indexName: "foo", references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: ID! @index(name: "foo")
      team: Team @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new IndexTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError('Invalid @hasMany directive on Team.members - indexName is not supported with DynamoDB references.');
});

test('fails if property does not exist on related type with references', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member] @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      team: Team @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new IndexTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError('teamID is not a field in Member');
});

test('fails if an empty list of references is passed in', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member] @hasMany(references: [])
    }
    type Member @model {
      id: ID!
      team: Team @belongsTo(references: [])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError('Invalid @hasMany directive on members - empty references list');
});

test('fails if related type does not exist', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Foo] @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: String
      team: Team @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError('Schema validation failed.');
});

test('fails if hasMany related type is not an array', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: Member @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: String
      team: Team @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError('@hasMany must be used with a list. Use @hasOne for non-list types.');
});

test('fails if uni-directional hasMany', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member] @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: String
      team: Team
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError(
    'Uni-directional relationships are not supported. Add a @belongsTo field in Member to match the @hasMany field Team.members',
  );
});

test('fails if used as a has one relationship', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: Member @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: String
      team: Team @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError('@hasMany must be used with a list. Use @hasOne for non-list types.');
});

test('fails if primary relational field list type is required', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member]! @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: String
      team: Team @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError("@hasMany fields must not be required. Change 'Team.members: [Member]!' to 'Team.members: [Member]'");
});

test('fails if primary relational field element type required', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member!] @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: String
      team: Team @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError("@hasMany fields must not be required. Change 'Team.members: [Member!]' to 'Team.members: [Member]'");
});

test('fails if primary relational field list type and element type are required', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member!]! @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: String
      team: Team @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError("@hasMany fields must not be required. Change 'Team.members: [Member]!' to 'Team.members: [Member]'");
});

test('fails if related relational field is required', () => {
  const inputSchema = `
    type Team @model {
      id: ID!
      name: String!
      members: [Member] @hasMany(references: ["teamID"])
    }
    type Member @model {
      id: ID!
      teamID: String
      team: Team! @belongsTo(references: ["teamID"])
    }`;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError("@belongsTo fields must not be required. Change 'Member.team: Team!' to 'Member.team: Team'");
});

test('fails with inconsistent nullability of reference fields', () => {
  const inputSchema = `
    type Member @model {
      name: String
      teamId: String!
      teamMantra: String
      team: Team @belongsTo(references: ["teamId", "teamMantra"])
    }
    type Team @model {
      id: String! @primaryKey(sortKeyFields: ["mantra"])
      mantra: String!
      members: [Member] @hasMany(references: ["teamId", "teamMantra"])
    }
  `;

  expect(() =>
    testTransform({
      schema: inputSchema,
      transformers: [new ModelTransformer(), new PrimaryKeyTransformer(), new HasManyTransformer(), new BelongsToTransformer()],
    }),
  ).toThrowError(
    "Reference fields defined on related type: 'Member' for @hasMany(references: ['teamId', 'teamMantra']) Team.members relationship have inconsistent nullability." +
      "\nRequired fields: 'teamId'" +
      "\nNullable fields: 'teamMantra'" +
      "\nUpdate reference fields on type 'Member' to have consistent nullability -- either all required or all nullable.",
  );
});

test('hasMany / hasOne - belongsTo across data source type boundary', () => {
  const mockSqlStrategy = mockSqlDataSourceStrategy();

  const inputDdbSchema = `
    type Member @model {
      name: String
      team: Team @belongsTo(references: "teamId")
      teamId: String
    }

    type Project @model {
      name: String
      teamId: String
      team: Team @belongsTo(references: "teamId")
    }

    type Team @model {
      id: String! @primaryKey
      mantra: String
      members: [Member] @hasMany(references: "teamId")
      project: Project @hasOne(references: "teamId")
    }
  `;

  const out = testTransform({
    schema: inputDdbSchema,
    transformers: [
      new ModelTransformer(),
      new PrimaryKeyTransformer(),
      new HasOneTransformer(),
      new HasManyTransformer(),
      new BelongsToTransformer(),
    ],
    dataSourceStrategies: {
      Member: DDB_DEFAULT_DATASOURCE_STRATEGY,
      Project: DDB_DEFAULT_DATASOURCE_STRATEGY,
      Team: mockSqlStrategy,
    },
  });

  expect(out).toBeDefined();
  const schema = parse(out.schema);
  validateModelSchema(schema);
  expect(out.resolvers['Team.project.req.vtl']).toBeDefined();
  expect(out.resolvers['Team.project.req.vtl']).toMatchSnapshot();
  expect(out.resolvers['Team.members.req.vtl']).toBeDefined();
  expect(out.resolvers['Team.members.req.vtl']).toMatchSnapshot();
  expect(out.resolvers['Project.team.req.vtl']).toBeDefined();
  expect(out.resolvers['Project.team.req.vtl']).toMatchSnapshot();
  expect(out.resolvers['Member.team.req.vtl']).toBeDefined();
  expect(out.resolvers['Member.team.req.vtl']).toMatchSnapshot();
});

test('many to many query', () => {
  const inputSchema = `
      type Post @model {
        id: ID!
        title: String!
        editors: [PostEditor] @hasMany(references: ["postID"])
      }
      type PostEditor @model(queries: null) {
        id: ID!
        postID: ID!
        editorID: ID!
        post: Post @belongsTo(references: ["postID"])
        editor: User @belongsTo(references: ["editorID"])
      }
      type User @model {
        id: ID!
        username: String!
        posts: [PostEditor] @hasMany(references: ["editorID"])
      }`;

  const out = testTransform({
    schema: inputSchema,
    resolverConfig: {
      project: {
        ConflictDetection: 'VERSION',
        ConflictHandler: ConflictHandlerType.AUTOMERGE,
      },
    },
    transformers: [
      new ModelTransformer(),
      new IndexTransformer(),
      new HasOneTransformer(),
      new HasManyTransformer(),
      new BelongsToTransformer(),
    ],
  });

  expect(out).toBeDefined();
  const schema = parse(out.schema);
  validateModelSchema(schema);
  expect(out.schema).toMatchSnapshot();
});

test('has many references with partition key + sort key', () => {
  const inputSchema = `
    type Member @model {
      name: String
      teamId: String
      teamMantra: String
      team: Team @belongsTo(references: ["teamId", "teamMantra"])
    }
    type Team @model {
      id: String! @primaryKey(sortKeyFields: ["mantra"])
      mantra: String!
      members: [Member] @hasMany(references: ["teamId", "teamMantra"])
    }
  `;

  const out = testTransform({
    schema: inputSchema,
    transformers: [
      new ModelTransformer(),
      new PrimaryKeyTransformer(),
      new HasOneTransformer(),
      new HasManyTransformer(),
      new BelongsToTransformer(),
    ],
  });

  expect(out).toBeDefined();
  const schema = parse(out.schema);
  validateModelSchema(schema);
  expect(out.resolvers['Mutation.createMember.preAuth.1.req.vtl']).toBeUndefined();
  expect(out.resolvers['Team.members.req.vtl']).toBeDefined();
  expect(out.resolvers['Team.members.req.vtl']).toMatchSnapshot();
  expect(out.resolvers['Member.team.req.vtl']).toBeDefined();
  expect(out.resolvers['Member.team.req.vtl']).toMatchSnapshot();
});

test('has many references with multiple sort keys', () => {
  const inputSchema = `
    type Member @model {
      name: String
      teamId: String
      teamMantra: String
      teamOrganization: String
      team: Team @belongsTo(references: ["teamId", "teamMantra", "teamOrganization"])
    }
    type Team @model {
      id: String! @primaryKey(sortKeyFields: ["mantra", "organization"])
      mantra: String!
      organization: String!
      members: [Member] @hasMany(references: ["teamId", "teamMantra", "teamOrganization"])
    }
  `;

  const out = testTransform({
    schema: inputSchema,
    transformers: [
      new ModelTransformer(),
      new PrimaryKeyTransformer(),
      new HasOneTransformer(),
      new HasManyTransformer(),
      new BelongsToTransformer(),
    ],
  });

  expect(out).toBeDefined();
  const schema = parse(out.schema);
  validateModelSchema(schema);
  expect(out.resolvers['Mutation.createMember.preAuth.1.req.vtl']).toBeDefined();
  expect(out.resolvers['Mutation.createMember.preAuth.1.req.vtl']).toMatchSnapshot();
  expect(out.resolvers['Team.members.req.vtl']).toBeDefined();
  expect(out.resolvers['Team.members.req.vtl']).toMatchSnapshot();
  expect(out.resolvers['Member.team.req.vtl']).toBeDefined();
  expect(out.resolvers['Member.team.req.vtl']).toMatchSnapshot();
});
