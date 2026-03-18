from flask import Flask, render_template, jsonify, request, redirect, url_for
import numpy as np
import pandas as pd
import sys, os
import requests

app = Flask(__name__)
app.debug = True

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/timeseries')
def timeseries():
    return render_template('timeseries.html')

@app.route('/about')
def about():
    return render_template('about.html')


@app.route('/currentdata')
def current():
    r = requests.get("https://apaw.cspc.edu.ph/API/sensordata?date=latest")
    data = r.json()
    return data

@app.route('/timeseries/data')
def timeseriesdata():
    col = request.args.get('col')
    r = requests.get("https://apaw.cspc.edu.ph/API/timeseries?data="+ col)
    data = r.json()
    for d in data['data']['sensor_data']:
        d["x"] = d.pop("sensordataDateTime")
        d["y"] = d.pop(col)
    return data


@app.route('/temporary')
def temporary():
    r = requests.get("https://apaw.cspc.edu.ph/API/transmission?data=temporary")
    data = r.json()
    return data

if __name__=="__main__":
    app.run(debug=True)
