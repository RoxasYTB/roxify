export class PassphraseRequiredError extends Error {
  constructor(message = 'Passphrase required') {
    super(message);
    this.name = 'PassphraseRequiredError';
  }
}

export class IncorrectPassphraseError extends Error {
  constructor(message = 'Incorrect passphrase') {
    super(message);
    this.name = 'IncorrectPassphraseError';
  }
}

export class DataFormatError extends Error {
  constructor(message = 'Data format error') {
    super(message);
    this.name = 'DataFormatError';
  }
}

