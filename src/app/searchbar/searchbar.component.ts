import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { ParametersService, RGOptions } from '../parameters.service';
import { MatSnackBar } from '@angular/material';
import { MatchesService } from '../matches.service';
import { StringDecoder, NodeStringDecoder } from 'string_decoder';

const childProcess = (<any>window).require('child_process');
const { rgPath } = (<any>window).require('vscode-ripgrep');
const { platform } = (<any>window).require('process');

@Component({
  selector: 'app-searchbar',
  templateUrl: './searchbar.component.html',
  styleUrls: ['./searchbar.component.css'],
})
export class SearchbarComponent implements OnInit {
  query: string;
  corpusPath: string[];
  options: RGOptions;
  rg: RipGrepEngine;

  constructor(private parameters: ParametersService,
              public snackbar: MatSnackBar,
              private matches: MatchesService) { }

  openSnackBar(message: string) {
    this.snackbar.open(message, '', {duration: 2000});
  }

  submitQuery(query: string): void {
    this.parameters.changeQuery(query);
    if (this.corpusPath === undefined || this.corpusPath.length === 0) {
      this.openSnackBar('First select a corpus');
    } else if (this.query.replace(/\s/g, '') === '') {
      this.openSnackBar('You must specify a query');
    } else {
      this.rg = new RipGrepEngine(this.query, this.corpusPath, this.options);
      this.matches.run();
      this.rg.rg(this.matches);
    }
  }

  ngOnInit() {
    this.parameters.currentQuery.subscribe(query => this.query = query);
    this.parameters.currentCorpusPath.subscribe(corpusPath => this.corpusPath = corpusPath);
    this.parameters.currentOptions.subscribe(options => this.options = options);
  }

}

export class RipGrepEngine {
  private static RESULT_REGEX = /^\u001b\[m(\d+)\u001b\[m:(.*)(\r?)/;
  private static FILE_REGEX = /^\u001b\[m(.+)\u001b\[m$/;

  public static MATCH_START_MARKER = '\u001b[m\u001b[31m';
  public static MATCH_END_MARKER = '\u001b[m';

  private query: string;
  private corpusPath: string[];
  private contextWidth: number;

  private childProcess: typeof childProcess;
  private remainder: string;
  public isDone = false;
  private filepath: string;
  private stringDecoder: NodeStringDecoder;
  private args = ['--hidden', '--heading', '--line-number', '--color', 'ansi', '--colors',
    'path:none', '--colors', 'line:none', '--colors', 'match:fg:red',
    '--colors', 'match:style:nobold'];
  public matchList: LineMatch[] = [];

  constructor(query: string, corpusPath: string[], options: RGOptions) {
    this.childProcess = (<any>window).require('child_process');
    this.query = query;
    if (query.charAt(0) === '-') {
      this.query = '--regexp ' + this.query;
    }
    this.corpusPath = corpusPath;
    this.stringDecoder = new StringDecoder('utf-8');
    const { regex, usecase, word, context } = options;
    if (!regex) { this.args.push('--fixed-strings'); }
    if (!usecase) { this.args.push('--ignore-case'); }
    if (word) { this.args.push('--word-regexp'); }
    this.contextWidth = context;
  }

  rg(service): void {
    console.log(this.args);
    let cwd;
    if (platform === 'win32') {
      cwd = 'c:/';
    } else {
      cwd = '/';
    }
    const process = this.childProcess.spawn(
      rgPath, this.args.concat([this.query]).concat(this.corpusPath), { cwd });
    process.once('exit', () => {
      console.log('RG = DONE');
      console.log(this.handleData(this.stringDecoder.end()));
      service.updateMatches(this.matchList);
      service.stop();
    });
    process.stdout.on('data', data => {
      const dataStr = typeof data === 'string' ? data : this.stringDecoder.write(data);
      this.handleData(dataStr);
    });
  }

  handleData(dataStr: string) {
    const data = this.remainder ? this.remainder + dataStr : dataStr;
    const hadRemainder = this.remainder ? true : false;
    const lines: string[] = data.split(/\r\n|\n/);
    this.remainder = lines[lines.length - 1] ? lines.pop() : null;
    for (let line = 0; line < lines.length; line++) {
      const outputLine = lines[line].trim();
      let r: RegExpMatchArray;
      if (r = outputLine.match(RipGrepEngine.RESULT_REGEX)) {
        const lineNum = parseInt(r[1]) - 1;
        let matchText = r[2];
        if (r[3]) {
          matchText += RipGrepEngine.MATCH_END_MARKER;
        }
        if (!this.filepath) {
          throw new Error('Got match line for unknown file');
        }
        this.handleMatchLine(this.filepath, lineNum, matchText);
      } else if (r = outputLine.match(RipGrepEngine.FILE_REGEX)) {
        this.filepath = r[1];
      } else {
      }
    }
  }

  handleMatchLine(origin: string, lineNum: number, text: string): void {
    let lastMatchEndPos = 0;
    let matchTextStartPos = -1;
    let matchTextStartRealIdx = -1;
    let textRealIdx = 0;
    const lineMatch = new LineMatch(origin, lineNum);
    for (let i = 0; i < text.length - (RipGrepEngine.MATCH_END_MARKER.length - 1);) {
      if (text.substr(i, RipGrepEngine.MATCH_START_MARKER.length) === RipGrepEngine.MATCH_START_MARKER) {
        lineMatch.lhs = text.slice(lastMatchEndPos, i).slice(-this.contextWidth);
        i += RipGrepEngine.MATCH_START_MARKER.length;
        matchTextStartPos = i;
        matchTextStartRealIdx = textRealIdx;
      } else if ((text.substr(i, RipGrepEngine.MATCH_END_MARKER.length) === RipGrepEngine.MATCH_END_MARKER)) {
        lineMatch.match = text.slice(matchTextStartPos, i);
        matchTextStartPos = -1;
        matchTextStartRealIdx = -1;
        i += RipGrepEngine.MATCH_END_MARKER.length;
        lastMatchEndPos = i;
      } else {
        i++;
        textRealIdx++;
      }
    }
    lineMatch.rhs = text.slice(lastMatchEndPos).slice(0, this.contextWidth);
    this.matchList.push(lineMatch);
  }

  wrapLine(line: string) {

  }
}

export class LineMatch {
  origin: string;
  filename: string;
  lineNumber: number;
  lhs: string;
  match: string;
  rhs: string;

  constructor(origin: string, lineNum: number) {
    this.origin = origin;
    if (origin === undefined) {
        console.log(origin);
    }
    this.filename = origin.split('/').slice(-1)[0];
    this.lineNumber = lineNum;
  }
}
